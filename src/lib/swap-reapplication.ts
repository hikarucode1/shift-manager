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
  /** 承認時刻。並べ替えはこの関数の中で行うので、渡す順序は問わない */
  decidedAt: Date | null;
  /** decidedAt が同値/null のときの決定的な第 2 キー */
  createdAt: Date;
};

/** 取り込みで挿入した確定シフト (誰がどのコマに居るか) */
export type InsertedShift = {
  tutorId: string;
  date: string;
  slotNumber: number;
};

export type SkipReason =
  /**
   * 新しい CSV に元の講師も代講者も居ない。基礎シフトが組み直された、または
   * その日が休講になった。座席表からそのコマ自体が消えている。
   */
  | "requester-absent"
  /**
   * 元の講師は居ないが**代講者が既に居る** = CSV が代講後の状態を反映している。
   * ⚠️ **これは異常ではない**。付け替えは不要で、座席表と申請履歴は一致している。
   * 一括で「食い違うので確認してください」と赤にすると偽陽性になり、警告が
   * 無視される訓練になる (レビュー指摘)。痕跡 (is_override/note) だけ付け直す。
   */
  | "already-reflected"
  /**
   * 代講者が既にそのコマに居る。付け替えると
   * `weekly_shifts_unique (upload_id, tutor_id, date, slot_number)` に衝突して
   * **取り込みが丸ごとロールバックする**ので、ここで落として警告に回す。
   */
  | "applicant-conflict";

export type PlannedUpdate = {
  swapId: string;
  date: string;
  slotNumber: number;
  /** WHERE に使う現在の担当 */
  matchTutorId: string;
  /** SET する担当 (already-reflected では matchTutorId と同じ = 痕跡だけ付ける) */
  setTutorId: string;
  /** note に書く「A → B」の A / B */
  noteFromId: string;
  noteToId: string;
};

export type ReapplicationPlan = {
  /** 実行する更新 (付け替え、または痕跡の付け直し) */
  applies: PlannedUpdate[];
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

  // ⚠️ 決定的に並べる。decidedAt が同値だと Array#sort は安定ソートなので
  // **入力順 = DB のヒープ順**にフォールバックし、この関数が潰したはずの
  // 「実際は C なのに B が確定する」が復活する (レビューで実測)。null も
  // epoch 扱いだと先頭に来てしまうので、第 2・第 3 キーで必ず順序を決める。
  const ordered = [...approvedSwaps].sort(
    (a, b) =>
      (a.decidedAt?.getTime() ?? a.createdAt.getTime()) -
        (b.decidedAt?.getTime() ?? b.createdAt.getTime()) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  const plan: ReapplicationPlan = { applies: [], skipped: [] };

  for (const sw of ordered) {
    const k = key(sw.date, sw.slotNumber);
    const here = occupancy.get(k);

    const note = { noteFromId: sw.requesterId, noteToId: sw.applicantId };

    if (!here?.has(sw.requesterId)) {
      // CSV が既に代講を反映している = 付け替え不要。ただし is_override と note が
      // 無いままだと「代講だった」痕跡が黙って消えるので、そこだけ付け直す
      if (here?.has(sw.applicantId)) {
        plan.applies.push({
          swapId: sw.id,
          date: sw.date,
          slotNumber: sw.slotNumber,
          matchTutorId: sw.applicantId,
          setTutorId: sw.applicantId,
          ...note,
        });
        plan.skipped.push({
          swapId: sw.id,
          date: sw.date,
          slotNumber: sw.slotNumber,
          reason: "already-reflected",
        });
        continue;
      }

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

    // ⚠️ **在席マップを更新すること**。連鎖 (A→B の後の B→C) が積めるだけでなく、
    // 「先に適用した swap の requester が、後の swap の applicant」という経路
    // (コマに A と C が居て A→B 承認後に C→A も承認される) で、delete を怠ると
    // C→A が applicant-conflict と誤判定され復元されない (レビューで実測)。
    here.delete(sw.requesterId);
    here.add(sw.applicantId);
    plan.applies.push({
      swapId: sw.id,
      date: sw.date,
      slotNumber: sw.slotNumber,
      matchTutorId: sw.requesterId,
      setTutorId: sw.applicantId,
      ...note,
    });
  }

  return plan;
}
