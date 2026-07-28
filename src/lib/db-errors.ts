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

/**
 * drizzle(postgres-js) がラップした PG エラーから SQLSTATE code (例 "23514") を
 * 取り出す。code は wrapper (DrizzleQueryError) ではなく `cause` 側に入るため、
 * isUniqueViolation と同様に cause チェーンを辿る。見つからなければ null。
 *
 * ⚠️ 各所で使われていた `"code" in err ? String(err.code) : null` は wrapper の
 * トップレベルしか見ないため常に null になる dead check だった (#175 review)。
 * PG の SQLSTATE で分岐したいときは必ずこのヘルパーを使うこと。
 */
export function pgErrorCode(e: unknown): string | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const o = cur as { code?: unknown; cause?: unknown };
    if (typeof o.code === "string" && o.code.length > 0) return o.code;
    cur = o.cause;
  }
  return null;
}
