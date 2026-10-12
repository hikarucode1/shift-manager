import {
  closeAction,
  type PendingSwapApproval,
} from "@/lib/pending-swap-approval";
// 型だけ。notifications.ts は server-only だが、型の import は消えるので
// クライアント (request-log-panel) から読んでも問題ない
import type { NotificationInput } from "@/lib/notifications";

/**
 * #293 より前の記録で閉じずに残っていた元講師の募集。記録を取り消して担当が
 * 戻ると、再び承認できる状態になる (応募者には知らせない。#293 で決めた)
 */
export type PendingSwapAfterCancel = {
  /** 募集を出した講師 */
  requesterName: string;
  isProxy: boolean;
  approval: PendingSwapApproval;
};

/**
 * 承認済み代講を取り消したあと、教室長に出す知らせ。
 *
 * - 欠勤の自動失効は戻さないので、登録し直しを促す (#225)
 * - 代講者の欠勤を失効させたら、誰の分かと、取り消しが誤りだった場合の戻し方 (#291)
 * - 代講者が同じコマに出していた募集は、担当が元講師に戻って承認できなくなる
 *   ので、システムが閉じた (#287 / #293)。教室長の操作は要らない
 * - 記録の取り消しで、元講師の募集が記録のときに閉じられていたら、募集し直しを
 *   案内する (#293)。閉じた募集は開き直さない
 *
 * ⚠️ **講師に知らせたとは書かない。** 講師への通知は best-effort (失敗しても
 * 取り消しは成功扱い)。
 */
export function swapCancelNotice(res: {
  expiredAbsences: number;
  /**
   * 代講者のそのコマの欠勤を失効させたなら、その代講者の名前 (#291)。
   * 一意制約で、失効するのは多くても 1 件
   */
  substituteExpiredName: string | null;
  /** 代講者が同じコマに出していた募集を閉じたなら、その代講者の名前 (#293) */
  substituteSwapClosedName: string | null;
  /**
   * 記録の取り消しで、元講師の募集が記録のときに閉じられていたなら、その
   * 元講師の名前 (#293)。過去のコマは募集し直せないので null
   */
  requesterSwapClosedName: string | null;
  /** #293 より前の記録で閉じずに残っていた元講師の募集 */
  requesterPendingSwap: PendingSwapAfterCancel | null;
}): string {
  const parts = ["取り消しました。"];
  if (res.expiredAbsences > 0) {
    parts.push(
      "このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  }
  // ⚠️ 代講者の失効は、ふだんは「登録し直して」と案内しない (代講者はもう
  // このコマの担当ではないので、登録し直す欠勤ではない)。ただし失効は戻せない
  // ので、取り消しが誤りだった場合の戻し方だけ書く (#291)
  if (res.substituteExpiredName) {
    parts.push(
      `代講者の ${res.substituteExpiredName} さんがこのコマに出していた欠勤申請は、担当でなくなったため失効させました（取り消しが誤りで、${res.substituteExpiredName} さんが実際には休む場合は、記録し直したあと「代理で欠勤を登録する」から登録してください）。`,
    );
  }
  if (res.substituteSwapClosedName) {
    parts.push(
      `代講者の ${res.substituteSwapClosedName} さんがこのコマに出していた交代・代講の募集は、担当でなくなって承認できなくなったため締め切りました。`,
    );
  }
  if (res.requesterSwapClosedName) {
    parts.push(
      `${res.requesterSwapClosedName} さんがこのコマに出していた交代・代講の募集は、記録したときに締め切っています。代講が必要なら「代理で代講を募集する」から募集し直してください。`,
    );
  }
  // 承認できない理由と閉じ方 (却下 / 取り下げ) は「未対応」タブと同じ
  // `pendingSwapApproval` の結果から作る
  const p = res.requesterPendingSwap;
  if (p) {
    parts.push(
      p.approval.approvable
        ? `このコマには ${p.requesterName} さんの交代申請が残っていて、担当が戻ったため再び承認できます。「未対応」タブで承認するか、${closeAction(p.isProxy)}`
        : `このコマには ${p.requesterName} さんの交代申請が「未対応」タブに残っています。${p.approval.notice ?? ""}`,
    );
  }
  return parts.join("");
}

/**
 * 代講を取り消したとき、代講者 B への通知「引き受けた代講が取り消されました」に
 * 足す一文 (#287 / #293)。B の名前で出ていた募集を閉じていなければ何も足さない。
 *
 * - 「このコマの募集」と書くと、B が元講師の募集に応募している場合にその
 *   応募まで無効と読めるので、「あなたの名前で出ていた」と限定する。教室長の
 *   代理募集 (#231) もあるので「あなたが出した」とは書かない
 * - 募集はシステムが閉じた (#293) ので、教室長の対応を待たせる書き方はしない
 * - 行き先は変えない (`/tutor/open-swaps`)。この通知の本題は代講が取り消された
 *   ことで、その結果 (#245「決まった代講が取り消されました」) が見えるのは
 *   open-swaps だけ
 */
export function substituteCancelSuffix(substituteSwapClosed: boolean): string {
  return substituteSwapClosed
    ? " ／ このコマの担当ではなくなったため、あなたの名前で出ていた交代・代講の募集は締め切りました。"
    : "";
}

/** 募集の応募者への通知の理由。経路で違う (#288 レビュー) */
export const ORPHANED_WHY = {
  /** 記録 (#253): 担当が代講者に変わった */
  recorded: "このコマは別の形で対応されました。",
  /**
   * 代講の取り消し (#287): 担当が元に戻った。**名前を出さない** — 元講師本人も
   * 宛先に入るので、「担当が 山田 さんに戻った」だと本人に自分の名前が
   * 第三者のように届く
   */
  cancelled: "代講が取り消され、このコマの担当が元に戻りました。",
} as const;

/**
 * 担当が変わって承認できなくなり、システムが閉じた募集の、応募者への通知
 * (#253 / #287 / #293)。記録と代講の取り消しで同じ題にし、理由だけ変える。
 * 本文に**誰の募集か**を入れる — 同じコマに 2 つの募集があると、どちらの話か
 * 分からない (#288)。閉じたことでの通知は別に出さないので、応募者に届くのは
 * これ 1 通だけ
 */
export function noLongerApprovableForApplicants(
  date: string,
  slotLabel: string,
  ownerName: string,
  why: string,
): NotificationInput {
  return {
    type: "swap_result",
    title: "応募していた代講の募集は締め切られました",
    body: `対象: ${date} ${slotLabel} (${ownerName}さんの募集) ／ ${why}担当が変わって承認できなくなったため、募集は締め切られました。`,
    href: "/tutor/open-swaps",
  };
}
