"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull, not, or } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { db } from "@/db/client";
import {
  absenceRequests,
  swapApplications,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { findPendingSwap, hasSlotEnded } from "@/lib/swaps";
import { designeeError } from "@/lib/designee-check";
import { isUniqueViolation } from "@/lib/db-errors";
import { slotLabelSafe } from "@/lib/slot-meta";
import { isValidIsoDate, noticeDate } from "@/lib/week";
import { ABSENCE_CLOSED_UNASSIGNED_NOTE } from "@/lib/pending-absence-actions";
import {
  ABSENCE_AUTO_EXPIRED_NOTE,
  ABSENCE_EXPIRED_UNASSIGNED_NOTE,
} from "@/lib/absence-expiry";
import { absenceTutorAssigned } from "@/lib/absences";
import { sendDesignatedRequest } from "@/lib/designation-request";
import { createOpenSwapOnBehalf } from "./swap-actions";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * 取り消し理由に使わせない文言 (システムが `decision_note` に書く文言)。
 * #292 以降、閉じ方の種類は `close_kind` で判定するので、同じ文言を書いても
 * 分類は変わらない。それでも、台帳のコメント欄に「交代成立により自動失効」
 * などと出ると紛らわしいので弾いておく
 */
const RESERVED_NOTES: readonly string[] = [
  ABSENCE_CLOSED_UNASSIGNED_NOTE,
  ABSENCE_AUTO_EXPIRED_NOTE,
  ABSENCE_EXPIRED_UNASSIGNED_NOTE,
];

const CancelApprovedAbsenceInput = z.object({
  // zod 既定の英語メッセージ ("Invalid UUID") が画面に出るのを防ぐ
  id: z.string().uuid("対象が正しく指定されていません。"),
  reason: z
    .string()
    .trim()
    .min(1, "取り消し理由を入力してください。")
    .max(500, "取り消し理由は 500 文字以内で入力してください。")
    // システムが書く文言は使わせない (RESERVED_NOTES)
    .refine((r) => !RESERVED_NOTES.includes(r), {
      message: "その文言はシステムが使う印なので、取り消し理由には使えません。別の言い方で書いてください。",
    }),
});

/**
 * 承認済みの欠勤を取り消す (#219)。
 *
 * ⚠️ **これが無いと `approved` は終端状態**だった。`decideAbsenceRequest` /
 * `cancelAbsenceRequest` はどちらも `status = 'pending'` 条件付きで、approved
 * から出る経路は交代承認時の自動失効だけ。交代申請が無ければ発火しないので、
 * 「先週の欠勤を誤って承認した」場合に週次シフト表の取り消し線を消す手段が
 * アプリに存在しなかった。
 *
 * ⚠️ 日付・コマのガードは付けない。#178 / #211 / #213 と同じ結論で、これは
 * 「改竄」ではなく**実態の記録**。むしろ過去のコマこそ是正したい。ガードの
 * 代わりに**理由を必須**にし、`decided_by` / `decided_at` を上書きして
 * 「誰がいつ取り消したか」を残す。
 *
 * ⚠️ `weekly_shifts` は触らない。欠勤の承認は `absence_requests.status` しか
 * 変えず、表示側 (`getApprovedAbsenceKeysAll`) が status を見ているため、
 * status を戻すだけで表示も戻る。`cancelApprovedSwap` (#213) が担当の
 * 付け替えを確認する必要があったのに対し、こちらが単純なのはこの差による。
 *
 * ⚠️ `pending` へは戻さない。理由は監査ではなく**運用**:
 *   1. `getPendingAbsenceRequests` の未対応キューに戻り、講師が出していない
 *      申請を教室長が再び処理することになる
 *   2. 部分 unique `absence_requests_active_uniq` は `pending` / `approved` が
 *      対象なので、`pending` に戻すと講師の出し直しを塞いだままになる
 *   `cancelled` にすれば両方とも解ける。
 *
 * ⚠️ `cancelled` には 5 経路から到達する。どの経路かは `close_kind` (#292) で
 * 判別する (`decision_note` の文言や `decided_by` の有無では判定しない):
 *   - この関数:            `admin_cancel`。`decided_by` / `decided_at` あり
 *   - 不要として閉じる (#289, `closeUnassignedAbsence`):
 *                          `unassigned`。`decided_by` / `decided_at` あり。
 *                          **pending から来る** (承認を経ていない)。台帳では
 *                          「教室長が取り下げ」(承認前に閉じた) に出す
 *   - 交代成立の自動失効:   `auto_expired`。`decided_by` **null**。
 *                          元講師が交代の承認・代講の記録でコマを失ったとき
 *   - 担当でなくなった自動失効 (#291):
 *                          `expired_unassigned`。`decided_by` **null**。
 *                          代講者が代講の取り消しでコマを失ったとき
 *   - 講師の自己取り下げ:   `tutor_withdraw`。`decided_by` / `decided_at` とも null
 * ただし**「承認を経由したか」は依然として判別できない**。`decided_by` /
 * `decided_at` は最後の決定で上書きされ、承認時の値は残らないため。
 * 承認履歴が要るなら別テーブルが要る (現状そこまでの要求は無い)。
 */
export async function cancelApprovedAbsence(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = CancelApprovedAbsenceInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id, reason } = parsed.data;

  const updated = await db
    .update(absenceRequests)
    .set({
      status: "cancelled",
      closeKind: "admin_cancel",
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: reason,
      updatedAt: new Date(),
    })
    // approved 以外 (既に取り消し済み / 却下済み) には打たせない。
    // 二重送信でも 2 回目は 0 行になり、下でその旨を返す
    .where(
      and(eq(absenceRequests.id, id), eq(absenceRequests.status, "approved")),
    )
    .returning({
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
    });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "取り消せませんでした（既に対応済みの可能性があります）。",
    };
  }

  // ⚠️ 承認を通知しているのに取り消しが無音だと、**講師は休むつもりのまま
  // 来ない**。承認と同じ absence_result で送る
  await notify([updated[0].tutorId], {
    type: "absence_result",
    title: "欠勤の承認が取り消されました",
    body: `対象日: ${noticeDate(updated[0].date)} ／ ${reason}`,
    href: "/tutor/absences",
  });

  // #331: この欠勤から出した代講の依頼 (相手の返事待ち) を閉じる。休む講師が
  // 出勤するので、指定された相手に引き受けさせてはいけない (引き受けは欠勤が
  // 承認済みかも確かめて断るが、一覧に残ると押せそうに見える)
  const closedRequests = await db
    .update(swapRequests)
    .set({
      status: "cancelled",
      closeKind: "admin_withdraw",
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: "欠勤の承認が取り消されたため",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(swapRequests.absenceRequestId, id),
        eq(swapRequests.status, "pending"),
      ),
    )
    .returning({ nomineeId: swapRequests.nominatedTutorId });
  const nominees = closedRequests
    .map((r) => r.nomineeId)
    .filter((v): v is string => v !== null);
  if (nominees.length > 0) {
    await notify(nominees, {
      type: "swap_result",
      title: "代講の依頼が取り消されました",
      body: `対象日: ${noticeDate(updated[0].date)} ／ 欠勤の承認が取り消されたため`,
      href: "/tutor/open-swaps",
    });
  }

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  revalidatePath("/tutor/open-swaps");
  return { ok: true };
}


/* ------------------------------------------------------------------ */
/*  #217 代理登録 — 電話 / LINE / 口頭で来た欠勤を教室長が記録する       */
/* ------------------------------------------------------------------ */

const OnBehalfInput = z.object({
  tutorId: z.string().uuid("講師が正しく指定されていません。"),
  date: z.string().refine(isValidIsoDate, "日付が不正です。"),
  slotNumber: z.number().int().min(1).max(20),
  reason: z
    .string()
    .trim()
    .min(1, "理由を入力してください（連絡手段も書いてください）。")
    .max(500, "理由は 500 文字以内で入力してください。"),
  /** 本番チェック メモ25: 登録と一緒にする代講の次の一手 (省略時は none) */
  followUp: z.enum(["designate", "recruit", "none"]).optional().default("none"),
  designatedSubstituteId: z.string().uuid().nullable().optional(),
});

/**
 * 教室長が代理で欠勤を登録する (#217)。
 *
 * ⚠️ **急な欠勤は電話 / LINE / 直接で教室長に来る**。サイトを経由しないので
 * 講師の申請フロー (`createAbsenceRequest`) では記録できず、しかもそちらは
 * 過去日を弾くため、**事後に実態へ合わせる手段がアプリに無かった**。
 * 事前に分かっている欠勤は従来どおり講師が申請する。入口を 2 つ持つ。
 *
 * ⚠️ 日付・コマのガードは付けない。#178 / #211 / #213 / #219 と同じ結論で、
 * これは「改竄」ではなく**実態の記録**。むしろ過去日こそ本命。
 *
 * ⚠️ `pending` を経由せず直接 `approved` にする。既に起きた事実に対して
 * 「申請 → 承認」の体裁を取らせても、承認は誰も判断していない空手続きになる。
 * 代わりに `created_by` に教室長を残し、**本人申告と代理登録を区別できる
 * ようにする** (勤怠でモメたときに要る)。
 *
 * ⚠️ 未処理の交代申請があっても**塞がない**。「交代を募集したが誰も応募せず、
 * 結局その講師が休んだ」は普通に起きる。塞ぐと #217 が直したはずの詰みが
 * 別の形で戻る。代わりに戻り値で知らせ、画面で交代側の処理を促す。
 */
export async function createAbsenceOnBehalf(
  input: unknown,
): Promise<
  | {
      ok: true;
      pendingSwap: boolean;
      /** 代講の指名・募集ができなかった理由 (欠勤の登録はできている) */
      followUpError: string | null;
      /** 指名した講師の名前 (指名できたとき) */
      designeeName: string | null;
    }
  | { ok: false; error: string }
> {
  const { profile } = await requireRole("admin");

  const parsed = OnBehalfInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "入力が不正です。" };
  }
  const { tutorId, date, slotNumber, reason, followUp } = parsed.data;
  const designatedSubstituteId =
    followUp === "designate" ? (parsed.data.designatedSubstituteId ?? null) : null;
  if (followUp !== "none" && (await hasSlotEnded(date, slotNumber))) {
    return {
      ok: false,
      error: "終了したコマには代講の指名・募集はできません。「何もしない」で登録してください。",
    };
  }
  if (followUp === "designate") {
    if (!designatedSubstituteId) {
      return { ok: false, error: "代講に指名する講師を選んでください。" };
    }
    const error = await designeeError({
      absentTutorId: tutorId,
      designeeId: designatedSubstituteId,
      date,
      slotNumber,
    });
    if (error) return { ok: false, error };
  }

  // 実在する確定シフトか (クライアントを信用しない)。交代が承認済みなら
  // weekly_shifts は代講者に付け替わっているので、ここで弾かれる
  const shift = await db
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, tutorId),
        eq(weeklyShifts.date, date),
        eq(weeklyShifts.slotNumber, slotNumber),
      ),
    )
    .limit(1);
  if (shift.length === 0) {
    return {
      ok: false,
      error: "その講師はこのコマの担当ではありません。",
    };
  }

  // 記録・取り消し (#253 / #283) と同じ関数で探す
  const swapDup = await findPendingSwap(tutorId, date, slotNumber);

  let absenceId: string;
  try {
    const [row] = await db
      .insert(absenceRequests)
      .values({
        tutorId,
        createdBy: profile.id,
        date,
        slotNumber,
        reason,
        status: "approved",
        decidedBy: profile.id,
        decidedAt: new Date(),
        designatedSubstituteId,
      })
      .returning({ id: absenceRequests.id });
    absenceId = row.id;
  } catch (e) {
    if (isUniqueViolation(e, "absence_requests_active_uniq")) {
      return { ok: false, error: "このコマには既に欠勤の記録があります。" };
    }
    console.error("createAbsenceOnBehalf insert failed", e);
    return {
      ok: false,
      error: "登録に失敗しました。時間をおいてお試しください。",
    };
  }

  // 本番チェック メモ25: 登録と一緒に、代講を指名 (B に直接依頼) か募集する。
  // 失敗しても欠勤の登録は戻さず、理由を返す
  let followUpError: string | null = null;
  let followUpNote = "";
  let designeeName: string | null = null;
  if (followUp === "designate") {
    const sent = await sendDesignatedRequest({ absenceId, actorId: profile.id });
    if (sent.ok) {
      designeeName = sent.designeeName;
      followUpNote = ` ／ 代講は${sent.designeeName}さんに依頼しました（返事待ち）`;
    } else {
      followUpError = sent.error;
    }
  } else if (followUp === "recruit") {
    const res = await createOpenSwapOnBehalf({
      tutorId,
      date,
      slotNumber,
      reason: `欠勤（${reason}）`.slice(0, 500),
    });
    if (res.ok) followUpNote = " ／ 代講は募集に出しました";
    else followUpError = res.error;
  }

  // ⚠️ 本人が申請していないので、記録したことは通知でしか本人に届かない。
  // 「聞いた内容と違う」に気づける唯一の経路
  // ⚠️ 登録はもうコミット済み。コマ名の取得で投げると通知が届かず、押し直しは
  // 一意制約で「既に記録があります」になる (`slotLabelSafe`)
  const slotLabel = await slotLabelSafe(slotNumber);
  await notify([tutorId], {
    type: "absence_result",
    title: "欠勤が登録されました（室長が登録）",
    body: `対象日: ${noticeDate(date)}${slotLabel} ／ ${reason}${followUpNote}`,
    href: "/tutor/absences",
  });

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  revalidatePath("/tutor/open-swaps");
  return {
    ok: true,
    pendingSwap: swapDup !== null,
    followUpError,
    designeeName,
  };
}

const CloseUnassignedInput = z.object({
  id: z.string().uuid("対象が正しく指定されていません。"),
});

/**
 * 担当でなくなったコマの未承認の欠勤申請を「不要として閉じる」(#289)。
 *
 * 代講の取り消し・CSV の取り込みなどで担当が変わると、元の担当者の欠勤申請が
 * 「未対応」に残る。却下すると講師に「却下されました」(=出勤しろ、と読める)
 * が届くので、中立に閉じる操作を別に用意する。カードの出し分けは
 * `pendingAbsenceActions`。
 *
 * ⚠️ **今も担当なら閉じない。** 担当かどうか (`absenceTutorAssigned`) は
 * UPDATE の WHERE に入れて、確認と書き込みを 1 つの文にする。窓は狭まるが
 * 消えない (exists は weekly_shifts をロックしないので、CSV の取り込みと同時に
 * 走るとすり抜けうる)。
 *
 * 状態は `cancelled`、理由は `ABSENCE_CLOSED_UNASSIGNED_NOTE`。台帳では
 * 「教室長が取り下げ」(承認前に閉じた)、講師の履歴では灰色の説明として出る。
 * `decided_by` は閉じた教室長 (自動失効と違い、教室長の判断なので null に
 * しない)
 */
export async function closeUnassignedAbsence(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const parsed = CloseUnassignedInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id } = parsed.data;

  const updated = await db
    .update(absenceRequests)
    .set({
      status: "cancelled",
      closeKind: "unassigned",
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: ABSENCE_CLOSED_UNASSIGNED_NOTE,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(absenceRequests.id, id),
        eq(absenceRequests.status, "pending"),
        not(absenceTutorAssigned()),
      ),
    )
    .returning({
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
    });

  if (updated.length === 0) {
    // 0 行の理由を見分ける。まだ pending なら「今も担当」で弾いた
    const [row] = await db
      .select({ status: absenceRequests.status })
      .from(absenceRequests)
      .where(eq(absenceRequests.id, id))
      .limit(1);
    return {
      ok: false,
      error:
        row?.status === "pending"
          ? "このコマは今も担当なので、承認か却下をしてください。"
          : "処理できませんでした（既に対応済みの可能性があります）。",
    };
  }

  const { tutorId, date, slotNumber } = updated[0];
  // ⚠️ コマ名の取得は失敗しても投げない (`slotLabelSafe`)。行はもう pending
  // ではないので、ここで action ごと落ちると押し直せず、講師に通知が届かない
  const slotLabel = await slotLabelSafe(slotNumber);
  // ⚠️ 「却下」と言わない。中立に、担当でなくなったことだけを伝える。
  // コマごと無くなった (CSV で休日) 場合もあるので、カードの案内と揃える
  await notify([tutorId], {
    type: "absence_result",
    title: "欠勤申請は不要になりました（担当が変わったか、コマが無くなったため）",
    body: `対象日: ${noticeDate(date)}${slotLabel} ／ このコマは今はあなたの担当ではありません。`,
    href: "/tutor/absences",
  });

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  #331 断られたあとに、代講を頼む相手を指定し直す                     */
/* ------------------------------------------------------------------ */

const RedesignateInput = z.object({
  absenceId: z.string().uuid(),
  designatedSubstituteId: z.string().uuid("講師を選んでください。"),
});

/**
 * 教室長: 指定した相手に断られた欠勤で、代講を頼む相手を指定し直す (#331)。
 * 本番チェック メモ21: 新しい相手には、教室長からそのまま依頼が届く
 * (休む講師が依頼し直す手順は無くした)。
 */
export async function redesignateSubstitute(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const parsed = RedesignateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { absenceId, designatedSubstituteId } = parsed.data;

  const [absence] = await db
    .select({
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
    })
    .from(absenceRequests)
    .where(
      and(
        eq(absenceRequests.id, absenceId),
        eq(absenceRequests.status, "approved"),
      ),
    )
    .limit(1);
  if (!absence) {
    return { ok: false, error: "対象の欠勤が見つかりません（取り消された可能性があります）。" };
  }
  if (await hasSlotEnded(absence.date, absence.slotNumber)) {
    return { ok: false, error: "終了したコマです。実際に入った代講は「あとから代講を記録する」から記録してください。" };
  }
  const error = await designeeError({
    absentTutorId: absence.tutorId,
    designeeId: designatedSubstituteId,
    date: absence.date,
    slotNumber: absence.slotNumber,
  });
  if (error) return { ok: false, error };
  // 返事待ちの依頼があるあいだは指定を変えない (相手が引き受けられなくなる)
  const [pendingLinked] = await db
    .select({ id: swapRequests.id })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.absenceRequestId, absenceId),
        eq(swapRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pendingLinked) {
    return { ok: false, error: "今の相手の返事を待っている依頼があります。" };
  }
  // 一度断った講師は選べない。`designationState` はその講師への依頼の結果を
  // 見るので、選ぶと「断られた」のまま依頼ボタンが出なくなる
  const [declinedBefore] = await db
    .select({ id: swapRequests.id })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.absenceRequestId, absenceId),
        eq(swapRequests.nominatedTutorId, designatedSubstituteId),
        eq(swapRequests.closeKind, "nominee_declined"),
      ),
    )
    .limit(1);
  if (declinedBefore) {
    return {
      ok: false,
      error: "この講師にはこの欠勤の代講を一度断られています。別の講師を選んでください。",
    };
  }

  await db
    .update(absenceRequests)
    .set({ designatedSubstituteId, updatedAt: new Date() })
    .where(
      and(
        eq(absenceRequests.id, absenceId),
        eq(absenceRequests.status, "approved"),
      ),
    );

  // 本番チェック メモ21: 休む講師を挟まず、新しい相手に直接依頼を送る
  const sent = await sendDesignatedRequest({ absenceId, actorId: profile.id });
  revalidatePath("/tutor/open-swaps");
  if (!sent.ok) {
    revalidatePath("/admin/requests");
    revalidatePath("/tutor/absences");
    return {
      ok: false,
      error: `指定し直しましたが、依頼を送れませんでした: ${sent.error}`,
    };
  }
  const slotLabel = await slotLabelSafe(absence.slotNumber);
  await notify([absence.tutorId], {
    type: "absence_result",
    title: "代講を頼む相手が変わりました",
    body: `対象: ${noticeDate(absence.date)} ${slotLabel} ／ 代講は${sent.designeeName}さんに依頼しました（返事待ち）`,
    href: "/tutor/absences",
  });

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  本番チェック メモ18: 間違えて承認した欠勤を「承認前に戻す」          */
/* ------------------------------------------------------------------ */

const RevertApprovalInput = z.object({
  id: z.string().uuid("対象が正しく指定されていません。"),
});

/**
 * 承認済みの欠勤を「未対応 (pending)」に戻す。承認をやり直せるようにする。
 *
 * `cancelApprovedAbsence` (取り消し) は欠勤そのものを閉じるので、講師に
 * 出し直してもらうしかなかった。こちらは承認の判断だけを無かったことにし、
 * 欠勤申請の一覧に戻す (講師の申請はそのまま)。
 *
 * - 承認と一緒に出した代講の依頼 (返事待ち) と、休む講師のコマに出した
 *   代講の募集 (応募待ち) は取り下げ、相手・応募者に知らせる
 * - 代講が決まっていれば欠勤は自動失効 (cancelled) しているので、
 *   approved の行だけを対象にすれば、決まった代講を戻すことは無い
 * - 部分 unique `absence_requests_active_uniq` は pending / approved の
 *   両方が対象なので、行を 1 つのまま状態だけ変えれば衝突しない
 */
export async function revertAbsenceApproval(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const parsed = RevertApprovalInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id } = parsed.data;
  const now = new Date();

  const reverted = await db
    .update(absenceRequests)
    .set({
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      designatedSubstituteId: null,
      updatedAt: now,
    })
    .where(
      and(eq(absenceRequests.id, id), eq(absenceRequests.status, "approved")),
    )
    .returning({
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
    });
  if (reverted.length === 0) {
    return {
      ok: false,
      error:
        "戻せませんでした（代講が決まった・取り消し済みなど、既に承認済みではない可能性があります）。",
    };
  }
  const absence = reverted[0];
  const slotLabel = await slotLabelSafe(absence.slotNumber);
  const note = "欠勤の承認が取り消され、確認中に戻ったため";

  // 承認と一緒に出した代講の依頼 (指名) と、休む講師のこのコマの募集
  const closed = await db
    .update(swapRequests)
    .set({
      status: "cancelled",
      closeKind: "admin_withdraw",
      decidedBy: profile.id,
      decidedAt: now,
      decisionNote: note,
      updatedAt: now,
    })
    .where(
      and(
        eq(swapRequests.status, "pending"),
        or(
          eq(swapRequests.absenceRequestId, id),
          and(
            eq(swapRequests.requesterId, absence.tutorId),
            eq(swapRequests.date, absence.date),
            eq(swapRequests.slotNumber, absence.slotNumber),
            eq(swapRequests.kind, "open"),
          ),
        ),
      ),
    )
    .returning({
      id: swapRequests.id,
      kind: swapRequests.kind,
      nomineeId: swapRequests.nominatedTutorId,
    });

  const nominees = closed
    .filter((r) => r.kind === "named" && r.nomineeId !== null)
    .map((r) => r.nomineeId as string);
  const openIds = closed.filter((r) => r.kind === "open").map((r) => r.id);
  const applicants =
    openIds.length > 0
      ? (
          await db
            .select({ id: swapApplications.applicantId })
            .from(swapApplications)
            .where(
              and(
                inArray(swapApplications.swapRequestId, openIds),
                isNull(swapApplications.withdrawnAt),
              ),
            )
        ).map((r) => r.id)
      : [];
  const body = `対象: ${noticeDate(absence.date)} ${slotLabel} ／ ${note}`;
  await Promise.all([
    notify([absence.tutorId], {
      type: "absence_result",
      title: "欠勤申請の承認を取り消し、確認中に戻しました",
      body: `対象: ${noticeDate(absence.date)} ${slotLabel} ／ 教室長があらためて確認します`,
      href: "/tutor/absences",
    }),
    nominees.length > 0
      ? notify(nominees, {
          type: "swap_result",
          title: "代講の依頼が取り下げられました",
          body,
          href: "/tutor/open-swaps",
        })
      : Promise.resolve(),
    applicants.length > 0
      ? notify([...new Set(applicants)], {
          type: "swap_result",
          title: "応募していた代講の募集が取り下げられました",
          body,
          href: "/tutor/open-swaps",
        })
      : Promise.resolve(),
  ]);

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  revalidatePath("/tutor/open-swaps");
  return { ok: true };
}
