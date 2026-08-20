/**
 * コマを一意に指す文字列キー (`"YYYY-MM-DD|slotNumber"`)。
 *
 * ⚠️ **`server-only` を付けないこと**。`getBusyTutorIdsBySlot` (server) が
 * 作るキーと、指名セレクト (client) が引くキーは**同じ関数で作る必要がある**。
 * 形式がずれても型は通り、`busyBySlot[target]` が常に undefined になって
 * 「同コマ出勤の講師が全員候補に残る」形で**黙って無効化される** (#181)。
 * `lib/swaps.ts` は `server-only` なので、そこに置くと client から使えず、
 * リテラルの手書きが復活してこの穴が開く。
 */
export function busySlotKey(date: string, slotNumber: number): string {
  return `${date}|${slotNumber}`;
}
