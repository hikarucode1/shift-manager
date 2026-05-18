/**
 * ライブ RLS チェック (運用補助・DB 接続)。
 *
 * 実 DB の全 public テーブルについて
 *   - rowsecurity = true か
 *   - anon / authenticated に残存テーブル権限が無いか
 * を検査し、違反があれば exit 1。本番/ステージングの状態確認に使う。
 *
 * Usage: NODE_OPTIONS=--conditions=react-server tsx scripts/check-rls.ts
 */

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  const tables = (await db.execute(sql`
    select tablename, rowsecurity
    from pg_tables
    where schemaname = 'public'
    order by tablename
  `)) as unknown as { tablename: string; rowsecurity: boolean }[];

  const grants = (await db.execute(sql`
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
    order by table_name, grantee
  `)) as unknown as {
    table_name: string;
    grantee: string;
    privilege_type: string;
  }[];

  const noRls = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);

  console.log(`public tables: ${tables.length}`);
  console.log(`  RLS off: ${noRls.length ? noRls.join(", ") : "なし"}`);
  console.log(
    `  anon/authenticated 残存権限: ${grants.length ? grants.length + " 件" : "なし"}`,
  );
  for (const g of grants) {
    console.log(`    ⚠ ${g.table_name}: ${g.grantee} ${g.privilege_type}`);
  }

  const ok = noRls.length === 0 && grants.length === 0;
  console.log(ok ? "✓ 全テーブル RLS 有効・anon/auth 権限なし" : "✗ 違反あり");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
