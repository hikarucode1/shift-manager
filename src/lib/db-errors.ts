/**
 * Postgres unique 制約違反か判定する共有ユーティリティ。
 *
 * drizzle(postgres-js) は実 PG エラーを "Failed query: ..." でラップし、
 * code 23505 / 制約名は `cause` 側に入る。そのため message だけでなく
 * エラーチェーン (cause) を辿って判定する。
 *
 * @param constraint 指定するとその制約名がメッセージに含まれる場合も true。
 */
export function isUniqueViolation(
  e: unknown,
  constraint?: string,
): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (o.code === "23505") return true;
    const msg = typeof o.message === "string" ? o.message : "";
    if (/unique constraint|duplicate key|23505/i.test(msg)) return true;
    if (constraint && msg.includes(constraint)) return true;
    cur = o.cause;
  }
  return false;
}
