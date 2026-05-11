/**
 * CSV パーサーから一意な講師名を抽出し、profiles に未登録のものを追加する。
 * テスト用: auth.users 連携なし (= ログイン不可)。本番では Issue #5 の招待フロー経由で作成する。
 */

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
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

  const existing = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.role, "tutor"));
  const existingSet = new Set(existing.map((p) => p.displayName));

  const toInsert = parsed.uniqueTeacherNames.filter((n) => !existingSet.has(n));

  if (toInsert.length === 0) {
    console.log("✓ 全講師がすでに登録済みです");
    process.exit(0);
  }

  console.log(`新規登録: ${toInsert.length} 名`);
  for (const name of toInsert) console.log(`  - ${name}`);

  // 各 stub プロファイルは ID を Postgres 側で gen_random_uuid() に任せる
  await db.insert(profiles).values(
    toInsert.map((name) => ({
      // id は defaultRandom() …といきたいが、profiles.id は PK で defaultRandom が無い
      // → 明示的に crypto.randomUUID() で渡す
      id: crypto.randomUUID(),
      displayName: name,
      role: "tutor" as const,
      // テスト用のダミーメール (実在しないが unique 制約は無いので OK)
      email: `stub-${name.replace(/\s/g, "")}@example.invalid`,
      isActive: true,
    })),
  );

  console.log("\n✓ 完了");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
