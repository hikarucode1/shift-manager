/**
 * #333: 提出期間外の変更申請の純粋なルール (DB に触らない部分)。
 */

/** 承認してから編集できる長さ (本人の決定、2026/11/17) */
export const CHANGE_UNLOCK_MS = 3 * 24 * 60 * 60 * 1000;

export function unlockUntilFrom(now: Date): Date {
  return new Date(now.getTime() + CHANGE_UNLOCK_MS);
}

export type ChangeGrantRow = {
  status: "pending" | "approved" | "rejected" | "closed";
  unlockedUntil: Date | null;
};

/** 承認済みで、まだ期限が来ていない = 今その講師だけ編集できる */
export function isGrantActive(row: ChangeGrantRow, now: Date): boolean {
  return (
    row.status === "approved" &&
    row.unlockedUntil !== null &&
    now.getTime() <= row.unlockedUntil.getTime()
  );
}

/** 承認済みだが期限切れ (closed に直すべき行) */
export function isGrantExpired(row: ChangeGrantRow, now: Date): boolean {
  return (
    row.status === "approved" &&
    row.unlockedUntil !== null &&
    now.getTime() > row.unlockedUntil.getTime()
  );
}

/**
 * レギュラーの変更申請の対象にする期: 提出受付が始まった期のうち、期の開始日が
 * いちばん新しいもの (= 今の提出の対象)。受付中の期があるときは申請は不要
 * (そのまま編集できる) なので、呼び出し側で先に弾く。
 */
export function pickRegularChangeTarget<
  P extends { id: string; startDate: string; submissionOpensAt: Date },
>(periods: P[], now: Date): P | null {
  const opened = periods
    .filter((p) => p.submissionOpensAt.getTime() <= now.getTime())
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return opened[0] ?? null;
}
