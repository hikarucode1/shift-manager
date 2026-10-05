"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, not } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { db } from "@/db/client";
import { absenceRequests, weeklyShifts } from "@/db/schema";
import { findPendingSwap } from "@/lib/swaps";
import { isUniqueViolation } from "@/lib/db-errors";
import { slotLabelSafe } from "@/lib/slot-meta";
import { isValidIsoDate, weekdayOf } from "@/lib/week";
import { ABSENCE_CLOSED_UNASSIGNED_NOTE } from "@/lib/pending-absence-actions";
import { absenceTutorAssigned } from "@/lib/absences";

type ActionResult = { ok: true } | { ok: false; error: string };

const CancelApprovedAbsenceInput = z.object({
  // zod 既定の英語メッセージ ("Invalid UUID") が画面に出るのを防ぐ
  id: z.string().uuid("対象が正しく指定されていません。"),
  reason: z
    .string()
    .trim()
    .min(1, "取り消し理由を入力してください。")
    .max(500, "取り消し理由は 500 文字以内で入力してください。")
    // ⚠️ 「不要として閉じる」(#289) の定型文は使わせない。台帳と講師の履歴は
    // この文言で「承認前に閉じた」と判定するので、承認済みの取り消しに同じ
    // 文言が入ると「承認された」事実が記録上消える (PR #290 のレビュー)
    .refine((r) => r !== ABSENCE_CLOSED_UNASSIGNED_NOTE, {
      message: `取り消し理由に「${ABSENCE_CLOSED_UNASSIGNED_NOTE}」は使えません。別の言い方で書いてください。`,
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
 * ⚠️ `cancelled` には 4 経路から到達する。#225 以降は**どの経路かは判別できる**:
 *   - この関数:            `decided_by` あり / `decided_at` あり
 *   - 不要として閉じる (#289, `closeUnassignedAbsence`):
 *                          `decided_by` あり / `decided_at` あり
 *                          (+ `decision_note = ABSENCE_CLOSED_UNASSIGNED_NOTE`)。
 *                          **pending から来る** (承認を経ていない)。台帳では
 *                          「教室長が取り下げ」(承認前に閉じた) に出す。
 *                          この関数の理由欄ではこの定型文を弾くので、
 *                          文言で取り違えることはない
 *   - 交代成立の自動失効:   `decided_by` **null** / `decided_at` あり
 *                          (+ `decision_note = ABSENCE_AUTO_EXPIRED_NOTE`)
 *   - 講師の自己取り下げ:   どちらも null
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
    body: `対象日: ${updated[0].date} ／ ${reason}`,
    href: "/tutor/absences",
  });

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
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
  { ok: true; pendingSwap: boolean } | { ok: false; error: string }
> {
  const { profile } = await requireRole("admin");

  const parsed = OnBehalfInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "入力が不正です。" };
  }
  const { tutorId, date, slotNumber, reason } = parsed.data;

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

  try {
    await db.insert(absenceRequests).values({
      tutorId,
      createdBy: profile.id,
      date,
      slotNumber,
      reason,
      status: "approved",
      decidedBy: profile.id,
      decidedAt: new Date(),
    });
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

  // ⚠️ 本人が申請していないので、記録したことは通知でしか本人に届かない。
  // 「聞いた内容と違う」に気づける唯一の経路
  // ⚠️ 登録はもうコミット済み。コマ名の取得で投げると通知が届かず、押し直しは
  // 一意制約で「既に記録があります」になる (`slotLabelSafe`)
  const slotLabel = await slotLabelSafe(slotNumber);
  const { label } = weekdayOf(date);
  await notify([tutorId], {
    type: "absence_result",
    title: "欠勤が登録されました（教室長による代理登録）",
    body: `対象日: ${date}（${label}）${slotLabel} ／ ${reason}`,
    href: "/tutor/absences",
  });

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  return { ok: true, pendingSwap: swapDup !== null };
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
  const { label } = weekdayOf(date);
  // ⚠️ 「却下」と言わない。中立に、担当でなくなったことだけを伝える。
  // コマごと無くなった (CSV で休日) 場合もあるので、カードの案内と揃える
  await notify([tutorId], {
    type: "absence_result",
    title: "欠勤申請は不要になりました（担当が変わったか、コマが無くなったため）",
    body: `対象日: ${date}（${label}）${slotLabel} ／ このコマは今はあなたの担当ではありません。`,
    href: "/tutor/absences",
  });

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  return { ok: true };
}
