import { jstDateOf, noticeDate } from "@/lib/week";

/**
 * 室長レビュー要望4 (2026/11/21): シフト提出の受付が始まったら講師に知らせる
 * 文面。講習は期間を作った時点、レギュラーは受付開始日時になった時点で送る。
 * 送る処理は src/lib/submission-open-sender.ts。
 */

/** 2026-11-30T14:59:00Z → "14:59" ではなく JST の "23:59" */
function jstTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}

export type SubmissionOpenNotice = {
  title: string;
  body: string;
  href: string;
  dedupKey: string;
};

/** 講習: 締切は「その日の終わり」で持っているので日付だけ出す */
export function courseOpenNotice(p: {
  id: string;
  name: string;
  submissionDeadline: Date | null;
}): SubmissionOpenNotice {
  return {
    title: `講習のシフト希望の提出が始まりました（${p.name}）`,
    body: p.submissionDeadline
      ? `締切は ${noticeDate(jstDateOf(p.submissionDeadline))}です。`
      : "早めに提出してください。",
    href: "/tutor/training",
    dedupKey: `course-open:${p.id}`,
  };
}

/** レギュラー: 締切は日時で持っているので時刻まで出す */
export function regularOpenNotice(p: {
  id: string;
  label: string;
  submissionDueAt: Date;
}): SubmissionOpenNotice {
  return {
    title: `レギュラーシフトの提出が始まりました（${p.label}）`,
    body: `締切は ${noticeDate(jstDateOf(p.submissionDueAt))}${jstTime(p.submissionDueAt)}です。`,
    href: "/tutor/fixed-shifts",
    dedupKey: `regular-open:${p.id}`,
  };
}

/**
 * 受付開始から (または期を作ってから) これより後に cron が初めて気づいた
 * ものは送らない。この機能を入れる前から受付中の期に、今さら「始まりました」
 * を送らないため
 */
const REGULAR_OPEN_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

/** 受付が始まったと判断する期か */
export function isRegularOpenDue(
  p: { submissionOpensAt: Date; submissionDueAt: Date; createdAt: Date },
  now: Date,
): boolean {
  if (p.submissionOpensAt.getTime() > now.getTime()) return false;
  if (p.submissionDueAt.getTime() <= now.getTime()) return false;
  // 開始日時を過去にして期を作った場合は、作った時点を「始まった」とみなす
  const startedAt = Math.max(
    p.submissionOpensAt.getTime(),
    p.createdAt.getTime(),
  );
  return now.getTime() - startedAt <= REGULAR_OPEN_GRACE_MS;
}
