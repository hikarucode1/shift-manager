/**
 * `weekly_shifts.note` に残す代講の痕跡 (#178 / #210)。
 *
 * この文字列が「誰が実際にそのコマに入ったか」の唯一の human-readable な記録で、
 * `is_override = true` と対になっている。**承認時 (decideSwapRequest) と、CSV
 * 取り込み後の再適用 (upload-commit) の両方で同じ形にすること** — 食い違うと
 * 同じ事実に 2 通りの記録が残り、後から読む人が別物だと誤解する。
 */
export function substitutionNote(fromName: string, toName: string): string {
  return `代講(承認済): ${fromName} → ${toName}`;
}
