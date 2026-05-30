/**
 * 月別レギュラー確定枠 (`monthly_regular_assignments`) のクライアント/サーバ共通ユーティリティ。
 *
 * 確定対象は (tutor, weekday, slot) の組で、bulk save は対象月の既存全件を
 * delete してから新規 insert する replace 方式。本ファイルではその直前段で
 * 使う pure 関数 (重複除去・diff 計算等) を提供する。
 */

export type AssignmentKey = {
  tutorId: string;
  weekday: string;
  slotNumber: number;
};

/** PK の文字列化。Set / Map のキーに使う */
export function assignmentKey(a: AssignmentKey): string {
  return `${a.tutorId}:${a.weekday}:${a.slotNumber}`;
}

/**
 * 同一 (tutor, weekday, slot) が複数回現れた場合に 1 つに圧縮する。
 * DB の PK 衝突を avoid するため bulk insert 直前に呼ぶ。
 * 順序は最初の出現を保つ。
 */
export function dedupeAssignments<T extends AssignmentKey>(
  assignments: ReadonlyArray<T>,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of assignments) {
    const k = assignmentKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * 旧確定セットと新確定セットを比較し、追加 / 削除する PK を返す。
 * replace 方式では使わないが、将来「差分だけ INSERT/DELETE」する最適化や
 * 監査ログ用途で便利なので一緒に置く。
 */
export function diffAssignments(
  prev: ReadonlyArray<AssignmentKey>,
  next: ReadonlyArray<AssignmentKey>,
): { added: AssignmentKey[]; removed: AssignmentKey[] } {
  const prevSet = new Set(prev.map(assignmentKey));
  const nextSet = new Set(next.map(assignmentKey));
  const added = next.filter((a) => !prevSet.has(assignmentKey(a)));
  const removed = prev.filter((a) => !nextSet.has(assignmentKey(a)));
  return { added, removed };
}
