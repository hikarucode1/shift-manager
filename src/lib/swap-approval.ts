import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  ABSENCE_AUTO_EXPIRED_NOTE,
  ABSENCE_EXPIRED_UNASSIGNED_NOTE,
} from "@/lib/absence-expiry";
import { isTutorBusyAt, type Executor } from "@/lib/swaps";
import { substitutionNote } from "@/lib/substitution-note";
import { jstToday } from "@/lib/week";
import {
  absenceRequests,
  profiles,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";

/**
 * 交代・代講の承認 (付け替え) を、教室長の承認 (`decideSwapRequest`) と、
 * 欠勤で指定された相手の引き受け (`acceptDesignatedSubstitution`, #331) の
 * 両方から使うために切り出したもの。中身は `decideSwapRequest` にあった
 * ものをそのまま移した (#331)。
 */

/** 承認処理中の「ユーザーに見せてよい」業務エラー (DB エラー等と区別) */
export class SwapBizError extends Error {}

/**
 * その講師の、その (日, コマ) の未処理の欠勤申請 (pending / approved) を自動
 * 失効させ、件数を返す。**担当を失った講師**に使う (「担当を失ったら、その
 * コマの欠勤は失効」):
 *
 * - 交代の承認・代講の記録で、元講師がコマを失う (#33)。`close_kind` は
 *   `auto_expired` (文言は `ABSENCE_AUTO_EXPIRED_NOTE`)
 * - 代講の取り消しで、代講者がコマを失う (#291)。`close_kind` は
 *   `expired_unassigned` (文言は `ABSENCE_EXPIRED_UNASSIGNED_NOTE`)
 *
 * ⚠️ **`decided_by` を null にする** (#225)。触らないと、承認済みだった欠勤が
 * 失効したとき「承認した教室長」がそのまま残り、画面に「取り消し: (その人の
 * 名前)」と出る。実際に取り消したのはその人ではない。失効は誰の判断でもない
 * ので、名前は消して時刻だけ残す
 */
export async function expireActiveAbsences(
  tx: Executor,
  tutorId: string,
  date: string,
  slotNumber: number,
  closeKind: "auto_expired" | "expired_unassigned",
): Promise<number> {
  const expired = await tx
    .update(absenceRequests)
    .set({
      status: "cancelled",
      // 種類は close_kind で判定する (#292)。note は台帳のコメント欄に出す文言
      closeKind,
      decidedBy: null,
      decidedAt: new Date(),
      decisionNote:
        closeKind === "auto_expired"
          ? ABSENCE_AUTO_EXPIRED_NOTE
          : ABSENCE_EXPIRED_UNASSIGNED_NOTE,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(absenceRequests.tutorId, tutorId),
        eq(absenceRequests.date, date),
        eq(absenceRequests.slotNumber, slotNumber),
        inArray(absenceRequests.status, ["pending", "approved"]),
      ),
    )
    .returning({ id: absenceRequests.id });
  return expired.length;
}

export type ApprovedSwapInfo = {
  requesterId: string;
  applicantId: string;
  requesterName: string;
  applicantName: string;
  date: string;
  slotNumber: number;
  expiredAbsences: number;
};

/**
 * 募集をロックし、代講者 (`resolveApplicant` が決める) へ確定シフトを付け替えて
 * 承認済みにする。**トランザクションの中で呼ぶこと**。業務上の失敗は
 * `SwapBizError` を投げる (トランザクションごと戻る)。
 *
 * `decidedBy` は `swap_requests.decided_by` に入る人。
 */
export async function approveSwapInTx(
  tx: Executor,
  {
    swapRequestId,
    decidedBy,
    resolveApplicant,
  }: {
    swapRequestId: string;
    decidedBy: string;
    /** 募集の行ロックを取ったあとに呼ばれる。代講者の id を返す */
    resolveApplicant: (req: {
      requesterId: string;
      date: string;
      slotNumber: number;
    }) => Promise<string>;
  },
): Promise<ApprovedSwapInfo> {
  // ⚠️ **`FOR UPDATE` を応募行を読む前に取る** (#249)。講師側の
  // `applyToSwap` / `withdrawApplication` は既に同じ行ロックを取って
  // いるのに、承認だけが素の SELECT で輪から外れていた。READ COMMITTED
  // では次の交差が通ってしまう:
  //
  //   1. 承認: 応募行を「取り下げられていない」状態で読む
  //   2. 取り下げ: 募集をロック → status=pending・approved_applicant_id
  //      は null なのでガードを通過 → withdrawn_at を立てて COMMIT
  //   3. 承認: status='pending' 条件の UPDATE が成功してしまう
  //
  // 結果は `approved` + `approved_applicant_id=本人` + **応募行は
  // 取り下げ済み**。`getTutorApplications` は「応募行があるか」で
  // `chosen` と `recorded` を分けるので、**応募して選ばれた講師に
  // 「教室長が代講として記録しました」と出る** (#247 で表に出た)。
  //
  // ロックを先に取ると 3 者が直列化される。取り下げが先なら承認は待って
  // から応募行を読むので withdrawn_at が見えて落ちる。承認が先なら
  // 取り下げは待たされ、`status=approved` かつ自分が採用済みという
  // 既存ガードで弾かれる。
  //
  // ⚠️ **クエリは増えない** (既存の SELECT に付けるだけ)。tx を握った
  // まま 2 本目の接続を要求しない、という `client.ts` の max:3 の前提は
  // 守られる。
  //
  // ⚠️ **ロックの順** (待ちの輪を作らないため、どの経路もこの順を守る):
  //   - 承認 (ここ): pending の募集 (この行) → weekly_shifts → absence_requests
  //   - 取り消し (`cancelApprovedSwap`): 代講者の pending の募集 (#293) →
  //     weekly_shifts → absence_requests (代講者の欠勤, #291) → approved の募集
  //   - 記録 (`recordSubstitution`): 元講師の pending の募集 (#293) →
  //     weekly_shifts → absence_requests
  // pending の募集は、触る経路がどれも**最初に**触る (#293 で、取り消しと
  // 記録が担当の変わる講師の pending の募集を閉じるようになった。
  // weekly_shifts を書く前に閉じないと、同じ募集の同時承認とデッドロック
  // しうる)。approved の募集は取り消しだけが最後に触り、承認は触らない。
  // absence_requests は承認と取り消しの両方が触るので、どちらも
  // weekly_shifts → absence_requests の順を守ること
  const reqRows = await tx
    .select({
      requesterId: swapRequests.requesterId,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
      status: swapRequests.status,
    })
    .from(swapRequests)
    .where(eq(swapRequests.id, swapRequestId))
    .for("update")
    .limit(1);
  if (reqRows.length === 0 || reqRows[0].status !== "pending") {
    throw new SwapBizError("対応済みの可能性があります。");
  }
  const req = reqRows[0];

  // #165: 過去日 (実施済み) のコマは承認しない。承認は weekly_shifts を
  // 代講者へ付け替えるため、日を跨いだ書き換えを防ぐ。
  //
  // ⚠️ **コマ単位まで厳しくしないこと** (#178 のレビュー結論)。承認は
  // 「誰が実際にそのコマに入ったか」を記録する経路で、is_override と
  // `代講(承認済): A → B` の note で監査痕跡も残る (#215 で
  // `recordSubstitution` が加わり「唯一の経路」ではなくなったが、
  // **承認をコマ単位で塞ぐ理由にはならない** — 応募まで進んだ案件を
  // 記録側へ移し替えさせるのは遠回り)。同日の
  // 終了済みコマを塞ぐと、実際は代講が入ったのに記録は元の講師のまま
  // 確定する (weekly_shifts を直す admin 画面は無く、CSV 再取り込みは
  // その日の代講記録を全消しする)。8 限は 21:25 終了で、教室長の事務作業は
  // その後なので、同日中の承認を残すことが運用上必要。
  //
  // ⚠️ ここを DB 参照 (hasSlotEnded) にしてはいけない。tx を握ったまま
  // 同じプールへ 2 本目を要求することになり、max:3 かつキュー待ちに上限が
  // 無いので承認が 3 本重なるとハングする (client.ts の前提を破る)。
  if (req.date < jstToday()) {
    throw new SwapBizError(
      "過去のコマの交代は承認できません (既に実施済みです)。",
    );
  }

  // 代講者を決める。⚠️ 募集の行ロック (上) を取ったあとに読むこと (#249)。
  // 教室長の承認なら選んだ応募、指定された相手の引き受けなら本人 (#331)
  const applicantId = await resolveApplicant(req);

  // 代講者が同じコマに既に出勤予定なら不可 (weekly_shifts_unique)
  if (await isTutorBusyAt(req.date, req.slotNumber, applicantId, tx)) {
    throw new SwapBizError("代講者は既にそのコマに出勤予定です。");
  }

  // 代講メモ用に氏名取得
  const names = await tx
    .select({ id: profiles.id, name: profiles.displayName })
    .from(profiles)
    .where(inArray(profiles.id, [req.requesterId, applicantId]));
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "不明";
  const subNote = substitutionNote(
    nameOf(req.requesterId),
    nameOf(applicantId),
  );

  // requester の確定シフトを代講者へ付け替え
  const reassigned = await tx
    .update(weeklyShifts)
    .set({ tutorId: applicantId, isOverride: true, note: subNote })
    .where(
      and(
        eq(weeklyShifts.tutorId, req.requesterId),
        eq(weeklyShifts.date, req.date),
        eq(weeklyShifts.slotNumber, req.slotNumber),
      ),
    )
    .returning({ id: weeklyShifts.id });
  if (reassigned.length === 0) {
    throw new SwapBizError("付け替え対象の確定シフトが見つかりません。");
  }

  // status='pending' を条件に「奪う」更新。同時承認は rowcount 0 で弾く
  const claimed = await tx
    .update(swapRequests)
    .set({
      status: "approved",
      approvedApplicantId: applicantId,
      decidedBy,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(swapRequests.id, swapRequestId),
        eq(swapRequests.status, "pending"),
      ),
    )
    .returning({ id: swapRequests.id });
  if (claimed.length === 0) {
    // 競合: 別承認が先に確定 → トランザクションごとロールバック
    throw new SwapBizError("既に他の操作で確定済みです。");
  }

  // クロス整合 (#33): requester はこのコマを失うので、同一コマの
  // 非終端 欠勤申請を自動失効。
  //
  // ⚠️ **これは defensive な掃除ではなく通常経路** (#217 で変わった)。
  // 教室長の代理登録 (`createAbsenceOnBehalf`) は pending 交代を塞がない
  // (「交代を募集したが応募が無く結局休んだ」を塞ぐと詰むため) ので、
  // 「approved 欠勤 + pending 交代」は正規の手順で作れる状態になった。
  // #217 以前は受容済み TOCTOU からしか到達しない状態だったが、
  // **今はここが主経路**。dead code と誤認して削らないこと。
  //
  // ⚠️ **`pending` 欠勤も対象なのは書き落としではない** (#230)。講師側の
  // `createSwapRequest` は #33 の欠勤ガードで「非終端の欠勤があれば交代
  // 申請不可」を守るが、**教室長側の `createOpenSwapOnBehalf` (#227) には
  // その確認が無い**。よって「pending 欠勤 + pending 交代」も代理募集から
  // 正規に作れる。承認したのに未処理の欠勤申請が残ると
  // `absence_requests_active_uniq` と #33 の前提が崩れるので、ここで
  // 失効させるのが正しい。本人には #250 で通知が飛ぶ (「記録」と言わない
  // 文言にしてあるのは、あるのが未決の申請でしかない場合があるため)。
  // 教室長には代理募集の選択肢に「欠勤申請あり（未承認）」と出して、
  // 先に承認/却下する機会を作ってある (#230)。
  const expired = await expireActiveAbsences(
    tx,
    req.requesterId,
    req.date,
    req.slotNumber,
    "auto_expired",
  );

  return {
    requesterId: req.requesterId,
    applicantId,
    requesterName: nameOf(req.requesterId),
    applicantName: nameOf(applicantId),
    date: req.date,
    slotNumber: req.slotNumber,
    expiredAbsences: expired,
  };
}
