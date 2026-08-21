/**
 * CSV 取り込み後に、承認済み代講の付け替えを組み立てる (#210)。
 *
 * 取り込みは対象日の `weekly_shifts` を全削除して CSV から作り直すので、
 * そのままだと**承認済みの代講が黙って巻き戻る** (担当が元に戻り、
 * `is_override` と note が消える。一方 `swap_requests` は approved のまま残るので
 * 申請履歴と座席表が食い違う)。CSV で基礎を作り直したうえに、承認済みの事実を
 * 積み直す必要がある。
 *
 * ⚠️ **DB に触る前に決めきるための純関数**。取り込みは実 DB でしか動かせず
 * ローカル検証ができないので、順序と衝突の判定をここに寄せてテストで固定する
 * (`groupBusyBySlot` / `findMappingDuplicates` と同じ流儀)。
 */

export type ApprovedSwap = {
  id: string;
  requesterId: string;
  applicantId: string;
  date: string;
  slotNumber: number;
  /** 承認時刻。**必ずこの昇順で渡すこと** (下記の連鎖の理由) */
  decidedAt: Date | null;
};

/** 取り込みで挿入した確定シフト (誰がどのコマに居るか) */
export type InsertedShift = {
  tutorId: string;
  date: string;
  slotNumber: number;
};

export type SkipReason =
  /** 新しい CSV に元の講師がそのコマに居ない (基礎シフト自体が変わった / 休講) */
  | "requester-absent"
  /**
   * 代講者が既にそのコマに居る。付け替えると
   * `weekly_shifts_unique (upload_id, tutor_id, date, slot_number)` に衝突して
   * **取り込みが丸ごとロールバックする**ので、ここで落として警告に回す。
   */
  | "applicant-conflict";

export type ReapplicationPlan = {
  /** 実行する付け替え */
  applies: { swapId: string; date: string; slotNumber: number; fromTutorId: string; toTutorId: string }[];
  /** 復元できなかったもの。**握り潰さず呼び出し側へ返す** */
  skipped: { swapId: string; date: string; slotNumber: number; reason: SkipReason }[];
};

const key = (date: string, slotNumber: number) => `${date}|${slotNumber}`;

/**
 * ⚠️ **`decidedAt` の昇順で処理すること**。A→B が承認された後、B が同じコマで
 * 再度募集して B→C も承認されうる (`swap_requests_active_uniq` は requester 違いなので
 * 効かない)。順序が逆だと B→C が「B が居ない」で落ちたあと A→B が適用され、
 * **実際は C なのに B が確定する**。しかも DB のヒープ順次第なので再現性が無い。
 */
export function planSwapReapplication(
  inserted: InsertedShift[],
  approvedSwaps: ApprovedSwap[],
): ReapplicationPlan {
  // コマごとの在席者。適用のたびに更新するので、連鎖が正しく積み上がる
  const occupancy = new Map<string, Set<string>>();
  for (const row of inserted) {
    const k = key(row.date, row.slotNumber);
    (occupancy.get(k) ?? occupancy.set(k, new Set()).get(k)!).add(row.tutorId);
  }

  const ordered = [...approvedSwaps].sort(
    (a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0),
  );

  const plan: ReapplicationPlan = { applies: [], skipped: [] };

  for (const sw of ordered) {
    const k = key(sw.date, sw.slotNumber);
    const here = occupancy.get(k);

    if (!here?.has(sw.requesterId)) {
      plan.skipped.push({
        swapId: sw.id,
        date: sw.date,
        slotNumber: sw.slotNumber,
        reason: "requester-absent",
      });
      continue;
    }

    if (here.has(sw.applicantId)) {
      plan.skipped.push({
        swapId: sw.id,
        date: sw.date,
        slotNumber: sw.slotNumber,
        reason: "applicant-conflict",
      });
      continue;
    }

    here.delete(sw.requesterId);
    here.add(sw.applicantId);
    plan.applies.push({
      swapId: sw.id,
      date: sw.date,
      slotNumber: sw.slotNumber,
      fromTutorId: sw.requesterId,
      toTutorId: sw.applicantId,
    });
  }

  return plan;
}
