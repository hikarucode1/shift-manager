import { jstDateOf, noticeDate } from "@/lib/week";

/**
 * 締切前日の通知 (2026/11/22 本人): 講習・レギュラーのシフト提出締切の
 * **前日 16:00 (JST)** に、有効な講師**全員** (提出済みの人も含む) へ送る。
 * 送る処理は src/lib/submission-open-sender.ts の `sendDueDeadlineEveNotices`。
 *
 * 通知の種別は受付開始と同じ `submission_opened` を使い、dedupKey で
 * 分ける (course-eve:<id> / regular-eve:<id>)。種別を増やすと DB の enum に
 * 値を足すマイグレーションが要るため。
 */

const JST_EVE_HOUR = 16;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * cron が止まっていたなどで、前日 16:00 からこれより遅れて気づいたものは
 * 送らない (夜中に「明日締切」が届かないように)
 */
const EVE_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * 締切日時 → 送る日時 (締切日の前日 16:00 JST)。
 * 締切ちょうど 0:00 は「前の日の終わり」として扱う (3/2 0:00 締切 = 3/1 まで)
 */
export function deadlineEveAt(deadline: Date): Date {
  const lastDay = jstDateOf(new Date(deadline.getTime() - 1));
  const hh = String(JST_EVE_HOUR).padStart(2, "0");
  return new Date(new Date(`${lastDay}T${hh}:00:00+09:00`).getTime() - DAY_MS);
}

/** 今、締切前日の通知を送る期か */
export function isDeadlineEveDue(
  p: {
    deadline: Date;
    createdAt: Date;
    /** レギュラーの受付開始。講習は作った時点で受付中なので null */
    opensAt: Date | null;
  },
  now: Date,
): boolean {
  const eve = deadlineEveAt(p.deadline).getTime();
  const t = now.getTime();
  if (t < eve) return false;
  if (t >= p.deadline.getTime()) return false;
  if (t - eve > EVE_GRACE_MS) return false;
  // 前日 16:00 を過ぎてから作った期は、受付開始の通知で締切を伝えているので送らない
  if (p.createdAt.getTime() >= eve) return false;
  // まだ受付が始まっていない (受付開始が締切前日 16:00 より後) なら送らない
  if (p.opensAt && p.opensAt.getTime() > t) return false;
  return true;
}

export type DeadlineEveNotice = {
  title: string;
  body: string;
  href: string;
  dedupKey: string;
};

/** 2026-12-10T14:59:59Z → JST の "23:59" */
function jstTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}

/** 全員に送るので、提出済みの人が慌てないよう一言添える */
const BODY_TAIL =
  "まだの人は提出してください。提出済みの人はそのままで大丈夫です。";

export function courseEveNotice(p: {
  id: string;
  name: string;
  submissionDeadline: Date;
}): DeadlineEveNotice {
  return {
    title: `講習のシフト希望の締切は明日です（${p.name}）`,
    body: `締切は ${noticeDate(jstDateOf(p.submissionDeadline))}です。${BODY_TAIL}`,
    href: "/tutor/training",
    dedupKey: `course-eve:${p.id}`,
  };
}

export function regularEveNotice(p: {
  id: string;
  label: string;
  submissionDueAt: Date;
}): DeadlineEveNotice {
  return {
    title: `レギュラーシフトの締切は明日です（${p.label}）`,
    body: `締切は ${noticeDate(jstDateOf(p.submissionDueAt))}${jstTime(p.submissionDueAt)}です。${BODY_TAIL}`,
    href: "/tutor/fixed-shifts",
    dedupKey: `regular-eve:${p.id}`,
  };
}
