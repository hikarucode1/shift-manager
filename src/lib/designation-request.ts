import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  absenceRequests,
  profiles,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { notify } from "@/lib/notifications";
import { isUniqueViolation } from "@/lib/db-errors";
import {
  hasSlotEnded,
  noSubstituteReason,
  isTutorBusyAt,
} from "@/lib/swaps";
import { slotLabelSafe } from "@/lib/slot-meta";
import { noticeDate } from "@/lib/week";

/**
 * 本番チェック メモ21: 教室長が指定した代講の相手 (B) に、依頼を直接届ける。
 *
 * 以前は、休む講師 (A) が自分の「欠勤等」の画面から B に依頼する手順が
 * 挟まっていた (講師が相手を選んで頼んでいた頃の名残)。A が忘れると代講が
 * 決まらないので、教室長が指定した時点でここから依頼を作る。
 *
 * 作る行は A が依頼していたときと同じ (`swap_requests` の named、
 * `requester_id` = A、`absence_request_id` でこの欠勤に紐づく)。違うのは
 * `created_by` が教室長になることだけ。B の引き受け・断り
 * (`acceptDesignatedSubstitution` / `declineDesignatedSubstitution`) は
 * そのまま使える。
 *
 * 室長レビュー要望2: 1 つの欠勤で複数の相手に同時に依頼できる (早い者勝ち)。
 * 相手は `designeeId` で渡す (省略時は `designated_substitute_id`)。
 *
 * 欠勤は承認済みであること。
 * 送れなかったときは理由を返す (欠勤の承認や指定は戻さない。A の画面には
 * 今まで通り依頼ボタンが出るので、そこから送り直せる)。
 */
export async function sendDesignatedRequest(i: {
  absenceId: string;
  /** 依頼を作った人 (教室長) */
  actorId: string;
  /** 依頼する相手。省略時は欠勤の `designated_substitute_id` */
  designeeId?: string;
}): Promise<{ ok: true; designeeName: string } | { ok: false; error: string }> {
  const [absence] = await db
    .select({
      id: absenceRequests.id,
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
      reason: absenceRequests.reason,
      designatedId: absenceRequests.designatedSubstituteId,
      tutorName: profiles.displayName,
    })
    .from(absenceRequests)
    .innerJoin(profiles, eq(profiles.id, absenceRequests.tutorId))
    .where(
      and(
        eq(absenceRequests.id, i.absenceId),
        eq(absenceRequests.status, "approved"),
      ),
    )
    .limit(1);
  if (!absence) {
    return { ok: false, error: "承認済みの欠勤が見つかりません。" };
  }
  const designatedId = i.designeeId ?? absence.designatedId;
  if (!designatedId) {
    return { ok: false, error: "代講の相手が指定されていません。" };
  }
  if (await hasSlotEnded(absence.date, absence.slotNumber)) {
    return { ok: false, error: "終了したコマなので依頼できません。" };
  }
  // まだ休む講師の担当か (担当でなければ代わってもらうコマが無い)
  const [shift] = await db
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, absence.tutorId),
        eq(weeklyShifts.date, absence.date),
        eq(weeklyShifts.slotNumber, absence.slotNumber),
      ),
    )
    .limit(1);
  if (!shift) {
    return {
      ok: false,
      error: "このコマは今は休む講師の担当ではないので、依頼できません。",
    };
  }
  const noSub = await noSubstituteReason(
    absence.tutorId,
    absence.date,
    absence.slotNumber,
  );
  if (noSub) return { ok: false, error: noSub };
  if (await isTutorBusyAt(absence.date, absence.slotNumber, designatedId)) {
    return {
      ok: false,
      error: "指定した講師は同じコマに出勤予定です。",
    };
  }

  // 指名の依頼と、募集・講師の交代申請は同じコマに並べない (DB の部分 unique
  // は別々なので、ここで確かめる。要望2で swap_requests_active_uniq から
  // 指名の依頼を外した)
  const [other] = await db
    .select({ id: swapRequests.id })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.requesterId, absence.tutorId),
        eq(swapRequests.date, absence.date),
        eq(swapRequests.slotNumber, absence.slotNumber),
        eq(swapRequests.status, "pending"),
        isNull(swapRequests.absenceRequestId),
      ),
    )
    .limit(1);
  if (other) {
    return {
      ok: false,
      error: "このコマには既に募集中・依頼中の申請があります。",
    };
  }

  try {
    await db.insert(swapRequests).values({
      requesterId: absence.tutorId,
      createdBy: i.actorId,
      kind: "named",
      nominatedTutorId: designatedId,
      date: absence.date,
      slotNumber: absence.slotNumber,
      reason: absence.reason,
      absenceRequestId: absence.id,
    });
  } catch (e) {
    if (isUniqueViolation(e, "swap_requests_designation_uniq")) {
      return { ok: false, error: "この講師には既に依頼中です。" };
    }
    console.error("sendDesignatedRequest failed", e);
    return { ok: false, error: "依頼の送信に失敗しました。" };
  }

  const [designee] = await db
    .select({ name: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, designatedId))
    .limit(1);
  const designeeName = designee?.name ?? "指定された講師";
  const slotLabel = await slotLabelSafe(absence.slotNumber);
  await notify([designatedId], {
    type: "swap_posted",
    title: "代講の依頼がありました（教室長から）",
    body: `対象: ${noticeDate(absence.date)} ${slotLabel} ／ ${absence.tutorName}さんの代講。「代講募集」の画面から引き受けるか断るかを選んでください`,
    href: "/tutor/open-swaps",
  });
  return { ok: true, designeeName };
}

/**
 * 室長レビュー要望2: 複数の相手にまとめて依頼する (早い者勝ち)。
 * 1 人ずつ `sendDesignatedRequest` を呼び、送れた相手の名前と、送れなかった
 * 理由 (「〇〇さん: …」) を返す。1 人でも送れれば、その欠勤は返事待ちになる
 */
export async function sendDesignatedRequests(i: {
  absenceId: string;
  actorId: string;
  designeeIds: readonly string[];
}): Promise<{ sentNames: string[]; errors: string[] }> {
  const sentNames: string[] = [];
  const errors: string[] = [];
  for (const designeeId of i.designeeIds) {
    const sent = await sendDesignatedRequest({
      absenceId: i.absenceId,
      actorId: i.actorId,
      designeeId,
    });
    if (sent.ok) {
      sentNames.push(sent.designeeName);
    } else {
      const [p] = await db
        .select({ name: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.id, designeeId))
        .limit(1);
      errors.push(`${p?.name ?? "指名した講師"}さん: ${sent.error}`);
    }
  }
  return { sentNames, errors };
}

/** 「Aさん」/「Aさん・Bさん（早い者勝ち）」 */
export function designeeNoteNames(names: readonly string[]): string {
  const joined = names.map((n) => `${n}さん`).join("・");
  return names.length > 1 ? `${joined}（早い者勝ち）` : joined;
}
