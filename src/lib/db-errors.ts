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

/**
 * PG エラーから違反した制約名を取り出す (#221)。見つからなければ null。
 *
 * SQLSTATE だけでは足りない場面がある。例えば `regular_shift_periods` の
 * 23514 は **0021 の CHECK (締切が期間外)** と **0026 の trigger (範囲外の
 * レギュラー確定枠)** の 2 経路で出るが、原因によって利用者への案内が
 * 正反対になる。
 *
 * ⚠️ **これは「DB の生エラー文言を画面に出す」ことではない。** 出さない方針
 * (#176) はそのままで、ここでは分類にだけ使い、画面には自前の文言を出す。
 *
 * ⚠️ **trigger が RAISE したエラーには制約名が無い**ので null が返る。
 * #176 の `updatePeriod` のように 2 経路とも trigger の場合は判別できず、
 * 併記するしかない。片方が CHECK のときだけこれで分けられる。
 *
 * postgres-js は `constraint_name`、node-postgres は `constraint` に入れる。
 * どちらも取れないときはメッセージ本文から拾う (`... constraint "名前"`)。
 */
export function pgConstraintName(e: unknown): string | null {
  type Node = {
    code?: unknown;
    constraint_name?: unknown;
    constraint?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  const chain: Node[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const o = cur as Node;
    chain.push(o);
    cur = o.cause;
  }

  // ① 構造化フィールドをチェーン全体で先に見る
  for (const o of chain) {
    for (const v of [o.constraint_name, o.constraint]) {
      if (typeof v === "string" && v.length > 0) return v;
    }
  }

  // ② 無ければメッセージ本文から。
  //
  // ⚠️ **SQLSTATE を持つノードに限る。** DrizzleQueryError の message は
  // `Failed query: <sql>\nparams: <params>` で、**利用者が自由入力した値
  // (期のラベル等) がそのまま入る**。ここを無条件に見ると、ラベルを
  // `constraint "..._chk"` にするだけで帰属を詐称でき、この関数が防ごうと
  // している誤帰属そのものを起こせる。
  for (const o of chain) {
    if (typeof o.code !== "string" || o.code.length === 0) continue;
    const msg = typeof o.message === "string" ? o.message : "";
    const m = /constraint "([^"]+)"/.exec(msg);
    if (m?.[1]) return m[1];
  }
  return null;
}
