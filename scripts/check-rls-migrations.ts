/**
 * 静的 RLS ガード (CI 用・DB 非接続)。
 *
 * drizzle/*.sql を全部読み、`CREATE TABLE` された各 public テーブルに
 * 対して、いずれかの migration で
 *   - ENABLE ROW LEVEL SECURITY
 *   - REVOKE ALL ... FROM anon, authenticated
 * が宣言されているかを検証する。1つでも欠ければ exit 1。
 *
 * 新規 public テーブルを RLS 無しで追加した PR を CI で落とすのが目的
 * (Supabase の default privileges で anon に再付与され PII 漏洩するため)。
 *
 * Usage: tsx scripts/check-rls-migrations.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "drizzle";

function loadSql(): string {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
}

/** SQL コメント (-- 行 / 不等号なしの C ブロック) を除去 (RG5) */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

// テーブル参照: 任意で "public." 修飾、識別子は引用符任意 (RG1/RG2)
//   例: foo / "foo" / public.foo / "public"."foo" / other.foo
const REF = String.raw`(?:("?)([a-z0-9_]+)\1\s*\.\s*)?("?)([a-z0-9_]+)\3`;

/**
 * keyword 直後のテーブル参照を集める。
 * schema が無い or public のものだけ table 名を返す (他スキーマは無視)。
 */
function tableNames(keyword: RegExp, sql: string): Set<string> {
  // keyword 側が末尾の空白を消費済み (… table\s+ 等) なので REF を直結
  const re = new RegExp(keyword.source + REF, "gi");
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const schema = m[2]; // undefined = 修飾なし
    const table = m[4];
    if (!schema || schema.toLowerCase() === "public") out.add(table);
  }
  return out;
}

function main() {
  const sql = stripComments(loadSql());

  const created = tableNames(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?/,
    sql,
  );
  // DROP TABLE は本プロジェクトでは未使用だが、将来用に除外
  for (const t of tableNames(/drop\s+table\s+(?:if\s+exists\s+)?/, sql)) {
    created.delete(t);
  }

  const rlsEnabled = new Set<string>();
  {
    const re = new RegExp(
      String.raw`alter\s+table\s+` +
        REF +
        String.raw`\s+enable\s+row\s+level\s+security`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      if (!m[2] || m[2].toLowerCase() === "public") rlsEnabled.add(m[4]);
    }
  }

  const revoked = new Set<string>();
  {
    const re = new RegExp(
      String.raw`revoke\s+all\s+on\s+(?:table\s+)?` +
        REF +
        String.raw`\s+from\s+anon\s*,\s*authenticated`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      if (!m[2] || m[2].toLowerCase() === "public") revoked.add(m[4]);
    }
  }

  const missingRls: string[] = [];
  const missingRevoke: string[] = [];
  for (const t of [...created].sort()) {
    if (!rlsEnabled.has(t)) missingRls.push(t);
    if (!revoked.has(t)) missingRevoke.push(t);
  }

  console.log(`public tables created: ${created.size}`);
  console.log(`  RLS enabled : ${rlsEnabled.size}`);
  console.log(`  anon/auth REVOKEd: ${revoked.size}`);

  if (missingRls.length === 0 && missingRevoke.length === 0) {
    console.log("✓ 全 public テーブルに RLS + REVOKE が宣言済み");
    process.exit(0);
  }

  if (missingRls.length > 0) {
    console.error(
      `✗ RLS 未有効: ${missingRls.join(", ")}\n` +
        `  → migration に ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY; を追加`,
    );
  }
  if (missingRevoke.length > 0) {
    console.error(
      `✗ anon/authenticated 未 REVOKE: ${missingRevoke.join(", ")}\n` +
        `  → migration に REVOKE ALL ON "<t>" FROM anon, authenticated; を追加`,
    );
  }
  process.exit(1);
}

main();
