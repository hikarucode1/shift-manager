// PR の migration が本番に適用済みかを、**本番に接続せずに**確かめる (#307)。
//
// main の migration guard (`check:migrations (production)`) が本番を読んだときに残す
// 「適用済みの一覧」(artifact `applied-migrations`。hash と created_at だけで、秘密は
// 含まない) と、PR の `drizzle/meta/_journal.json` を比べる。
//
// ⚠️ このリポジトリは公開 (public) で、PR の確認は fork からの PR でも動く。PR から
// 本番に接続する作りは、接続情報の漏れや接続の連打を防ぎきれなかった (#307 の
// レビュー) ので、PR の確認では本番にも秘密の情報にも触れない。
//
// PR の drizzle/ は PR の作者が書けるデータなので、形を確かめてから読む。
// 依存パッケージは使わない (npm ci を要らなくするため、Node の標準だけ)。
//
// Usage: node scripts/check-migrations-pr.mjs <applied-migrations.json> <changed-files.txt>
//   changed-files.txt: PR が変えたファイルのパス (1 行 1 つ)
//
// 終了コード: 0 = 全部適用済み、1 = 未適用がある、3 = 入力が想定外 (journal / 一覧)

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXIT_PENDING = 1;
const EXIT_BAD_INPUT = 3;
// 適用済みの一覧がこれより古ければ警告する (毎朝作り直すので、ふだんは 1 日以内)
const STALE_HOURS = 30;

// drizzle-kit が付ける名前 (`0037_absence_close_kind`。`--name` にはハイフンや大文字も
// 使える)。細工した名前で drizzle/ の外のファイルを読ませないよう、形を確かめる
const TAG_PATTERN = /^\d{4}_[A-Za-z0-9_-]+$/;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(EXIT_BAD_INPUT);
}

function main() {
  const [appliedPath, changedPath] = process.argv.slice(2);
  if (!appliedPath || !changedPath) fail("引数が足りません");

  // 適用済みの一覧 (main の migration guard が本番から作ったもの)
  let applied;
  try {
    applied = JSON.parse(readFileSync(appliedPath, "utf8"));
  } catch (e) {
    fail(`適用済みの一覧を読めません: ${e.message}`);
  }
  if (!Array.isArray(applied?.rows)) fail("適用済みの一覧の形が想定外です");
  const appliedHashes = new Set(applied.rows.map((r) => String(r.hash)));
  const maxCreatedAt = applied.rows.reduce(
    (m, r) => Math.max(m, Number(r.created_at) || 0),
    0,
  );

  // PR の journal
  let journal;
  try {
    journal = JSON.parse(
      readFileSync(join("drizzle", "meta", "_journal.json"), "utf8"),
    );
  } catch (e) {
    fail(`drizzle/meta/_journal.json を読めません: ${e.message}`);
  }
  if (!Array.isArray(journal?.entries)) fail("journal の entries が配列ではありません");
  const entries = journal.entries;
  for (const e of entries) {
    if (
      e === null ||
      typeof e !== "object" ||
      typeof e.tag !== "string" ||
      !TAG_PATTERN.test(e.tag) ||
      !Number.isSafeInteger(e.when)
    ) {
      fail(`journal の migration 名か時刻が想定外の形です: ${JSON.stringify(e)}`);
    }
    // 通常のファイルであること (シンボリックリンクやディレクトリは断る)
    let st;
    try {
      st = lstatSync(join("drizzle", `${e.tag}.sql`));
    } catch {
      fail(`journal にあるのに .sql が無い migration: ${e.tag}`);
    }
    if (!st.isFile()) fail(`${e.tag}.sql が通常のファイルではありません`);
  }

  const changed = new Set(
    readFileSync(changedPath, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const hashOf = (tag) =>
    createHash("sha256")
      .update(readFileSync(join("drizzle", `${tag}.sql`), "utf8"))
      .digest("hex");

  // 本番の監視 (`check-migrations.ts`) と同じ基準: hash が無いか、`when` が
  // 適用済みの最大の created_at より新しいなら未適用 (drizzle の判定は後者)
  const pending = [...entries]
    .sort((a, b) => a.when - b.when)
    .filter((e) => !appliedHashes.has(hashOf(e.tag)) || maxCreatedAt < e.when);

  console.log(
    `journal: ${entries.length} 本 / 適用済みの一覧: ${applied.rows.length} 行 (本番を読んだ時刻: ${applied.generatedAt ?? "不明"})`,
  );
  // 一覧が古いと、main の production job が本番を読めずに失敗し続けている
  // 可能性がある (失敗すると一覧は作られず、前のものが使われる)。毎朝作り直すので
  // ふだんは 1 日以内
  const ageHours = (Date.now() - Date.parse(applied.generatedAt)) / 3_600_000;
  if (!(ageHours <= STALE_HOURS)) {
    console.warn(
      `\n⚠️  適用済みの一覧が古い (${Number.isFinite(ageHours) ? `${Math.round(ageHours)} 時間前` : "時刻不明"})。\n` +
        `   main の check:migrations (production) が本番を読めずに失敗していないか確かめる`,
    );
  }

  if (pending.length === 0) {
    console.log(`\n✓ 全 ${entries.length} 本の migration が本番に適用済み`);
    return;
  }

  // この PR が足した (変えた) migration と、main 側の migration を分けて案内する
  const byPr = pending.filter((e) => changed.has(`drizzle/${e.tag}.sql`));
  const byMain = pending.filter((e) => !changed.has(`drizzle/${e.tag}.sql`));

  if (byMain.length > 0) {
    console.error(
      `\n✗ main 側の migration が本番に未適用です (この PR とは無関係):\n` +
        byMain.map((e) => `  - ${e.tag}`).join("\n"),
    );
  }
  if (byPr.length > 0) {
    console.error(
      `\n✗ この PR の migration が本番に未適用です:\n` +
        byPr.map((e) => `  - ${e.tag}`).join("\n"),
    );
  }
  // journal の順の崩れ (main 側・この PR の両方)。hash が無いのに when が適用済みの
  // 最新以下だと、drizzle-kit migrate に黙って飛ばされる
  const outOfOrder = pending.filter(
    (e) => !appliedHashes.has(hashOf(e.tag)) && e.when <= maxCreatedAt,
  );
  if (outOfOrder.length > 0) {
    console.error(
      `\n⚠️  ${outOfOrder.map((e) => e.tag).join(", ")} の when が、本番に適用済みの最新より古い。\n` +
        `   drizzle-kit migrate では黙って飛ばされる。この PR の分なら main に載せ直して作り直す。\n` +
        `   main の分なら手で流して記録を合わせる (docs/migration-policy.md の「journal の順に流す」と\n` +
        `   「direct SQL + tracking reconcile」)`,
    );
  }
  console.error(
    `\n→ レビューが済んで migration が確定してから本番に流す。流したら、\n` +
      `  1. Actions → migration guard → Run workflow (main) で適用済みの一覧を更新し\n` +
      `  2. この PR の check:migrations (pr) を Re-run する\n` +
      `  (docs/migration-policy.md)`,
  );
  process.exit(EXIT_PENDING);
}

try {
  main();
} catch (e) {
  // 想定外の例外も「入力が想定外」として扱う (「未適用」と誤って案内しない)
  fail(`想定外のエラー: ${e?.message ?? e}`);
}
