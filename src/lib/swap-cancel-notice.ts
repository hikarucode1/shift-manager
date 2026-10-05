import {
  closeAction,
  pendingSwapApproval,
  type PendingSwapApproval,
} from "@/lib/pending-swap-approval";
// 型だけ。notifications.ts は server-only だが、型の import は消えるので
// クライアント (request-log-panel) から読んでも問題ない
import type { NotificationInput } from "@/lib/notifications";

/**
 * 承認済み代講を取り消したあと、教室長に出す知らせ。
 *
 * - 欠勤の自動失効は戻さないので、登録し直しを促す (#225)
 * - 同じコマに元講師の募集が残っていれば、閉じるか承認するかを促す (#283)。
 *   記録 (#215) は募集を閉じないので、記録を取り消すと担当が戻って募集が
 *   再び承認できる状態になる
 * - 代講者が同じコマに出した募集が残っていれば、閉じるよう促す (#287)。
 *   担当が元講師に戻ったので、その募集は承認できない
 *
 * ⚠️ **講師に知らせたとは書かない。** 講師への通知は best-effort (失敗しても
 * 取り消しは成功扱い)。しかも元講師の募集の「また有効になりました」は、
 * 代講者 B が応募していても B には送らない (B には取り消しの通知が別に届く)。
 * 教室長に伝えるのは、教室長がすべきこと (承認か却下) だけにする。
 *
 * ⚠️ 承認できない理由と閉じ方 (却下 / 取り下げ) は、「未対応」タブと同じ
 * `pendingSwapApproval` の結果から作る。ここで文言を持つと、理由が増えたとき
 * にずれる
 */

/**
 * 取り消したコマに残っている pending 募集 1 件。元講師の募集 (#283) と
 * 代講者の募集 (#287) があり、両方残ることもある
 */
export type PendingSwapAfterCancel = {
  /** 募集を出した講師 */
  requesterName: string;
  isProxy: boolean;
  approval: PendingSwapApproval;
};

export function swapCancelNotice(res: {
  expiredAbsences: number;
  pendingSwaps: PendingSwapAfterCancel[];
}): string {
  const parts = ["取り消しました。"];
  if (res.expiredAbsences > 0) {
    parts.push(
      "このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  }
  for (const p of res.pendingSwaps) {
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
 * 足す一文 (#287 / #288)。B の名前で募集が出ていなければ何も足さない。
 *
 * - 「このコマの募集」と書くと、B が元講師の募集に応募している場合にその
 *   応募まで無効と読めるので、「あなたの名前で出ている」と限定する。教室長の
 *   代理募集 (#231) もあるので「あなたが出した」とは書かない
 * - **次の一手を書く。** B が自分で出した募集なら「交代申請」の画面から
 *   取り下げられる。代理募集は B には取り下げられない (`cancelSwapRequest` が
 *   createdBy で弾く) ので、教室長が対応すると書く
 * - 行き先は変えない (`/tutor/open-swaps`)。この通知の本題は代講が取り消された
 *   ことで、その結果 (#245「決まった代講が取り消されました」) が見えるのは
 *   open-swaps だけ。「交代申請」の画面には A の行は出ない (PR #288 のレビュー)
 */
export function substituteCancelSuffix(
  substituteSwap: { isProxy: boolean } | null,
): string {
  if (!substituteSwap) return "";
  return ` ／ このコマの担当ではなくなったため、あなたの名前で出ている交代・代講の募集は承認できません。${
    substituteSwap.isProxy
      ? "教室長が対応します。"
      : "「交代申請」の画面から取り下げてください。"
  }`;
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
  cancelled:
    "代講が取り消され、このコマの担当が元に戻ったため、この募集は承認できません。",
} as const;

/**
 * 担当が変わって承認できなくなった募集の、応募者への通知 (#253 / #287)。
 * 記録と代講の取り消しで同じ題にし、理由だけ変える。本文に**誰の募集か**を
 * 入れる — 同じコマに 2 つの募集があると、どちらの話か分からない (#288)
 */
export function noLongerApprovableForApplicants(
  date: string,
  slotLabel: string,
  ownerName: string,
  why: string,
): NotificationInput {
  return {
    type: "swap_result",
    title: "応募していた代講の募集は承認できなくなりました",
    body: `対象: ${date} ${slotLabel} (${ownerName}さんの募集) ／ ${why}`,
    href: "/tutor/open-swaps",
  };
}

/**
 * 担当が戻って再び承認できるようになった募集の、応募者への通知 (#283)。
 * 「承認できなくなりました」と対なので並べて置く
 */
export function approvableAgainForApplicants(
  date: string,
  slotLabel: string,
  ownerName: string,
): NotificationInput {
  return {
    type: "swap_result",
    title: "応募していた代講の募集がまた有効になりました",
    body: `対象: ${date} ${slotLabel} (${ownerName}さんの募集) ／ 代講の記録が取り消されたため、募集は再び承認を待っています。`,
    href: "/tutor/open-swaps",
  };
}

/**
 * コミット後に「まだ pending か」を確かめ直した結果。確認自体が失敗したら
 * `unknown` (どちらに倒すかは募集で違う。`planCancelNotices` 参照)
 */
export type RecheckResult = "pending" | "closed" | "unknown";

/**
 * 承認済み代講を取り消したあと、どの募集に何を送り、教室長に何を出すか
 * (#283 / #287 / #288)。**判断はここに集める** — 通知の判断で何度も不具合が
 * 見つかった場所なので、server action から出してテストで固める。
 *
 * - 元講師 A の募集: `pending` で承認できるときだけ「また有効になりました」。
 *   `unknown` では送らない (閉じた募集に送ると嘘になる)
 * - 代講者 B の募集: `pending` か `unknown` なら「承認できなくなりました」。
 *   B の募集は二度と承認できないので、送っても嘘にならず、送らないと応募者が
 *   待ち続ける
 * - 教室長への案内と B への追記は、**`pending` と確かめられたときだけ**出す
 *   (閉じたかもしれない募集を「残っています」と言わない)
 */
export function planCancelNotices(i: {
  /** A の募集 (取り消しで担当が戻ったので、承認できる可能性がある) */
  requesterSwap: { id: string; isProxy: boolean } | null;
  requesterRecheck: RecheckResult;
  /** B の募集 (担当でなくなったので、必ず承認できない) */
  substituteSwap: { id: string; isProxy: boolean } | null;
  substituteRecheck: RecheckResult;
  isPastDate: boolean;
  requesterName: string;
  substituteName: string;
}): {
  /** 「また有効になりました」を応募者に送る募集 */
  revivedSwapId: string | null;
  /** 「承認できなくなりました」を応募者に送る募集 */
  orphanedSwapId: string | null;
  /** 教室長への案内 (`swapCancelNotice` に渡す) */
  pendingSwaps: PendingSwapAfterCancel[];
  /** B への通知に足す一文 */
  substituteSuffix: string;
} {
  const entryFor = (
    swap: { isProxy: boolean },
    requesterName: string,
    requesterAssigned: boolean,
  ): PendingSwapAfterCancel => ({
    requesterName,
    isProxy: swap.isProxy,
    approval: pendingSwapApproval({
      isPastDate: i.isPastDate,
      requesterAssigned,
      // 見出しにしか効かない
      isEnded: false,
      isProxy: swap.isProxy,
    }),
  });
  const a =
    i.requesterSwap && i.requesterRecheck === "pending"
      ? entryFor(i.requesterSwap, i.requesterName, true)
      : null;
  const bConfirmed =
    i.substituteSwap && i.substituteRecheck === "pending"
      ? entryFor(i.substituteSwap, i.substituteName, false)
      : null;
  return {
    revivedSwapId:
      i.requesterSwap && a && a.approval.approvable ? i.requesterSwap.id : null,
    orphanedSwapId:
      i.substituteSwap && i.substituteRecheck !== "closed"
        ? i.substituteSwap.id
        : null,
    pendingSwaps: [a, bConfirmed].filter(
      (e): e is PendingSwapAfterCancel => e !== null,
    ),
    substituteSuffix: substituteCancelSuffix(
      bConfirmed && i.substituteSwap ? i.substituteSwap : null,
    ),
  };
}
