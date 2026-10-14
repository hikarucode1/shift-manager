/**
 * 本番 migration 適用状況チェック (read-only)。
 *
 * `drizzle/meta/_journal.json` と本番の `drizzle.__drizzle_migrations` を比較し、
 * **未適用の migration を列挙**する。1 本でも未適用なら exit 1。
 *
 * 背景 (2026-07-30): migration-policy で「任意」と分類していた 0029-0032 が本番未適用の
 * まま機能コードだけ deploy され、#155 の通知機能が 9 日間動いていなかった。ベルは
 * 失敗を握り潰す設計 (バッジ 0 のまま) で無症状だったため気づけなかった。
 * 「機能 PR をマージしたら migration 適用状況を確認する」を人手ルールで終わらせず
 * 機械的に検出できるようにするのが目的。
 *
 * drizzle の適用判定は `created_at` (= journal の `when` / folderMillis) のみを見るため
 * (`drizzle-orm/pg-core/dialect.cjs:59-69`)、本スクリプトも同じ基準で判定する。
 * あわせて hash の不一致 (journal と本番のズレ) も警告する。
 *
 * migrate と違い**通常のクエリなので pooler 経由でも動く** (Supavisor 経由で
 * drizzle-kit migrate が失敗するのとは別。docs/migration-policy.md 参照)。
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' npm run check:migrations
 *   npm run check:migrations -- 'postgresql://...'      # 引数で URL を渡す場合
 *   (DIRECT_URL があればそちらを優先)
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

type JournalEntry = { idx: number; tag: string; when: number };

// 終了コード (#307)。原因を分けておく (workflow は分岐に使っていないが、ログを
// 読むときに「未適用」と「読めない」「想定外」を取り違えないため)
const EXIT_PENDING = 1; // 未適用の migration がある
const EXIT_CANNOT_READ = 2; // 本番の migration テーブルを読めない (接続・権限)
const EXIT_BAD_JOURNAL = 3; // journal や .sql が想定外の形、ほか想定外のエラー

const url =
  process.argv[2] || process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL;

if (!url || url.includes("<project-ref>")) {
  console.error(
    "✗ 実 DATABASE_URL / DIRECT_URL が必要です (プレースホルダー不可)。\n" +
      "  Supabase ダッシュボード > Connect > Direct/Session pooler の接続文字列を使用",
  );
  process.exit(EXIT_CANNOT_READ);
}

// migration のファイル名の形 (drizzle-kit が付ける `0037_absence_close_kind`。
// `--name` にはハイフンや大文字も使える)。PR 用の `check-migrations-pr.mjs` と揃える
const TAG_PATTERN = /^\d{4}_[A-Za-z0-9_-]+$/;

function journalEntries(): JournalEntry[] {
  const j = JSON.parse(
    readFileSync(join("drizzle", "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  const bad = j.entries.filter(
    (e) => !TAG_PATTERN.test(e.tag) || !Number.isSafeInteger(e.when),
  );
  if (bad.length > 0) {
    console.error(
      `✗ journal の migration 名か時刻が想定外の形です: ${bad
        .map((e) => JSON.stringify(e.tag))
        .join(", ")}`,
    );
    process.exit(EXIT_BAD_JOURNAL);
  }
  // journal にあるのに .sql が無い (または通常のファイルでない) なら、DB に繋ぐ前に
  // 断る (hashOf が途中で落ちて接続が開いたままになるのを防ぐ)
  const missing = j.entries.filter((e) => {
    try {
      return !lstatSync(join("drizzle", `${e.tag}.sql`)).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    console.error(
      `✗ journal にあるのに .sql が無い (通常のファイルでない) migration: ${missing.map((e) => e.tag).join(", ")}`,
    );
    process.exit(EXIT_BAD_JOURNAL);
  }
  return [...j.entries].sort((a, b) => a.when - b.when);
}

function hashOf(tag: string): string {
  const raw = readFileSync(join("drizzle", `${tag}.sql`), "utf8");
  return createHash("sha256").update(raw).digest("hex");
}

async function main() {
  const entries = journalEntries();
  const sql = postgres(url!, { prepare: false, max: 1, idle_timeout: 5 });

  let rows: { hash: string; created_at: string }[];
  try {
    rows = (await sql`
      select hash, created_at from drizzle.__drizzle_migrations order by created_at
    `) as unknown as { hash: string; created_at: string }[];
  } catch (e) {
    console.error(`✗ 本番の migration テーブルを読めません: ${(e as Error).message}`);
    await sql.end().catch(() => {});
    process.exit(EXIT_CANNOT_READ);
  }

  // PR の確認 (`check-migrations-pr.mjs`) が本番に接続せずに比べられるよう、
  // 適用済みの一覧を書き出す (#307)。hash と created_at だけで、秘密は含まない。
  // workflow が artifact `applied-migrations` として残す
  const out = process.env.APPLIED_MIGRATIONS_OUT;
  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          rows: rows.map((r) => ({ hash: r.hash, created_at: String(r.created_at) })),
        },
        null,
        2,
      ),
    );
  }

  const maxCreatedAt = rows.reduce((m, r) => Math.max(m, Number(r.created_at)), 0);
  const appliedHashes = new Set(rows.map((r) => r.hash));

  // drizzle と同じ基準: max(created_at) < when なら未適用
  const pending = entries.filter((e) => maxCreatedAt < e.when);
  // hash ベースの不一致 (journal にあるが本番に記録なし。created_at 判定とズレたら警告)
  const missingHash = entries.filter((e) => !appliedHashes.has(hashOf(e.tag)));

  console.log(`journal: ${entries.length} 本 / 本番記録: ${rows.length} 行`);
  console.log(`max(created_at) = ${maxCreatedAt}`);

  if (missingHash.length !== pending.length) {
    console.warn(
      `\n⚠️  created_at 判定 (${pending.length} 本未適用) と hash 判定 (${missingHash.length} 本未記録) が不一致。\n` +
        `   手動 reconcile の created_at が journal の when とズレている可能性がある。\n` +
        `   → docs/migration-policy.md の「direct SQL + tracking reconcile」を参照\n` +
        `   hash 未記録: ${missingHash.map((e) => e.tag).join(", ") || "なし"}`,
    );
  }

  await sql.end();

  if (pending.length === 0 && missingHash.length === 0) {
    console.log(`\n✓ 全 ${entries.length} 本の migration が本番に適用済み`);
    process.exit(0);
  }

  console.error(
    `\n✗ 未適用の migration が ${Math.max(pending.length, missingHash.length)} 本あります:\n` +
      [...new Set([...pending, ...missingHash])]
        .sort((a, b) => a.when - b.when)
        .map((e) => `  - ${e.tag}`)
        .join("\n") +
      `\n\n  → docs/migration-policy.md の「migration ごとの適用方針」で破壊性を確認のうえ適用`,
  );
  process.exit(EXIT_PENDING);
}

main().catch((e) => {
  // 想定外の例外は「未適用」(1) と区別する
  console.error(`✗ 想定外のエラー: ${(e as Error)?.message ?? e}`);
  process.exit(EXIT_BAD_JOURNAL);
});
