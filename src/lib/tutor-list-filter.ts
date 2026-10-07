import type { InviteStatus } from "@/lib/invite-resend";

/**
 * 講師一覧 (`/admin/tutors`) の絞り込み。画面の部品から分けてあるのはテストを
 * 掛けるため (#302)。
 */

export type StatusFilter = "all" | "linked" | "pending" | "unlinked";

type ListedTutor = {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  linked: boolean;
  inviteStatus: InviteStatus | null;
};

// 「招待中」の絞り込みは再送の対象を探すためのもの。無効な講師には再送できない
// (mailTargetRefusal) ので数えない。
export function isResendable(
  t: Pick<ListedTutor, "isActive" | "inviteStatus">,
): boolean {
  return t.isActive && t.inviteStatus === "pending";
}

export function matchesStatus(t: ListedTutor, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "linked":
      return t.linked;
    case "pending":
      return isResendable(t);
    case "unlinked":
      return !t.linked;
  }
}

/** 検索欄の入力を `matchesQuery` に渡す形にする */
export function normalizeQuery(search: string): string {
  return search.trim().toLowerCase();
}

/** `query` は `normalizeQuery` を通したもの。空なら全員に当たる */
export function matchesQuery(t: ListedTutor, query: string): boolean {
  if (!query) return true;
  if (t.displayName.toLowerCase().includes(query)) return true;
  // 未連携行は UI 上メールを隠す (「ログイン未連携」表示) ため、
  // 隠れた実メールで誤ヒットしないよう連携済みのみメールを検索対象にする。
  return t.linked && t.email.toLowerCase().includes(query);
}

/**
 * 一覧に出すか。**編集を開いている行は、絞り込みにも検索にも当てはまらなく
 * なっても出す** (#302)。再送などが「状態が古い」で断られて読み直すと (#300)、
 * 行の状態が変わって絞り込みや検索から外れ、エラーが案内するボタンや入力欄
 * ごと消えるため。氏名を変えて検索から外れた場合も同じ。
 *
 * 教室長が自分で絞り込みや検索を変えて、編集中の行がそれに合わなくなるなら、
 * 画面側で編集を閉じる (`matchesView` で判定)。合わない行が一覧に居座らない
 * ようにするため。合っている間は閉じない (入力途中の内容を消さない)。
 */
export function isTutorVisible(
  t: ListedTutor,
  opts: { statusFilter: StatusFilter; query: string; editingId: string | null },
): boolean {
  if (t.id === opts.editingId) return true;
  return matchesView(t, opts);
}

/** 絞り込みと検索の両方に当たるか (編集中かどうかは見ない) */
export function matchesView(
  t: ListedTutor,
  view: { statusFilter: StatusFilter; query: string },
): boolean {
  return matchesStatus(t, view.statusFilter) && matchesQuery(t, view.query);
}
