/**
 * CSV 講師名 → DB tutor のマッピング検証。
 * クライアント(プレビュー)とサーバー(commit)で同じ判定を使うための純粋関数。
 *
 * 同一 tutorId に 2 つ以上の CSV 名が割り当てられると、同じ講師が
 * 同じ日・同じコマに重複して入りうるため weekly_shifts_unique 制約に違反する。
 * 「教室長が代講して別名で2回出る」等の正当ケースは Issue #14 で後追い検討。
 */

export type MappingDuplicate = {
  tutorId: string;
  /** この tutorId に割り当てられた CSV 上の講師名 (2 件以上) */
  csvNames: string[];
};

/** mappings: CSV講師名 → tutorId ("" は未割当) */
export function findMappingDuplicates(
  mappings: Record<string, string>,
): MappingDuplicate[] {
  const byTutor = new Map<string, string[]>();
  for (const [csvName, tutorId] of Object.entries(mappings)) {
    if (!tutorId) continue;
    const list = byTutor.get(tutorId);
    if (list) list.push(csvName);
    else byTutor.set(tutorId, [csvName]);
  }
  return [...byTutor.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([tutorId, csvNames]) => ({
      tutorId,
      csvNames: [...csvNames].sort((a, b) => a.localeCompare(b, "ja")),
    }));
}
