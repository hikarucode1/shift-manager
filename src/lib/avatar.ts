/**
 * 表示名 / id からアバター (頭文字の丸) を決定的に描くための小ヘルパ。
 * 講師管理・申請承認など複数画面で共通利用する。
 */

/** アバター背景色 (seed から決定的に選ぶ)。 */
const AVATAR_COLORS = [
  "bg-primary",
  "bg-accent",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-rose-600",
] as const;

/** seed (profile id 等) を AVATAR_COLORS のいずれかへ決定的にマップ。 */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** 表示名の先頭 1 文字 (空なら "?")。 */
export function avatarInitial(name: string): string {
  return name.trim().charAt(0) || "?";
}
