/**
 * CSV パーサーから一意な講師名を抽出し、profiles に未登録のものを追加する。
 *
 * ⚠️ これは開発/テスト専用の仮データ生成スクリプト。
 *    - 作成される profile は auth.users に対応行を持たない → ログイン不可
 *    - Issue #11 (RLS) 適用後は auth.uid() ベースのポリシーから見えなくなる
 *    - 本番では Issue #5 の招待フロー経由で正式作成すること
 */

import { readFileSync } from "node:fs";
import { db } from "../src/db/client";
import { profiles } from "../src/db/schema";
import { parseShiftCsvBuffer } from "../src/lib/shift-csv-parser";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: tsx scripts/seed-stub-tutors.ts <csv-path>");
  process.exit(1);
}

async function main() {
  const buf = readFileSync(csvPath);
  const parsed = parseShiftCsvBuffer(buf);

  // role を問わず display_name で突き合わせる。
  // (admin が CSV の講師名と同名だった場合に二重登録しないため)
  const existing = await db
    .select({ displayName: profiles.displayName })
    .from(profiles);
  const existingSet = new Set(existing.map((p) => p.displayName));

  const toInsert = parsed.uniqueTeacherNames.filter((n) => !existingSet.has(n));

  if (toInsert.length === 0) {
    console.log("✓ 全講師がすでに登録済みです");
    process.exit(0);
  }

  console.log("⚠️  仮データを作成します (auth 連携なし・ログイン不可)");
  console.log(`新規登録: ${toInsert.length} 名`);
  for (const name of toInsert) console.log(`  - ${name}`);

  await db.insert(profiles).values(
    toInsert.map((name) => ({
      // profiles.id は PK だが defaultRandom() を付けていないため明示生成
      id: crypto.randomUUID(),
      displayName: name,
      // #165 / 0028: role 列は削除済み (roles 配列のデフォルト ["tutor"] が入る)。
      // 死んだ role キーを渡していた (無視されて偶然動作) のを除去。
      // 実在しないダミーメール (.invalid は RFC 2606 予約 TLD)
      email: `stub-${name.replace(/\s/g, "")}@example.invalid`,
      isActive: true,
    })),
  );

  console.log("\n✓ 完了 (本番運用前に Issue #5 の招待フローで作り直すこと)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
