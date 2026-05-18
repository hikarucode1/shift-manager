/**
 * 孤児プロファイル検出 (運用補助・DB 接続)。
 *
 * `profiles.auth_user_id` が NOT NULL なのに対応する `auth.users` 行が
 * 無い = ログイン不可なのに「連携済み」に見える孤児を検出する。
 * 0009 の AFTER DELETE トリガ導入後は新規発生しないが、トリガ導入前に
 * 既に削除された legacy 分はここで検出・復旧する。
 *
 * Usage:
 *   tsx scripts/check-auth-orphans.ts          # 検出のみ (孤児ありで exit 1)
 *   tsx scripts/check-auth-orphans.ts --fix    # 孤児の auth_user_id を NULL 化
 *                                              # (= 未連携へ戻し再招待可能に)
 */

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  const fix = process.argv.includes("--fix");

  const orphans = (await db.execute(sql`
    select p.id, p.display_name, p.role, p.email, p.auth_user_id
    from public.profiles p
    where p.auth_user_id is not null
      and not exists (
        select 1 from auth.users u where u.id = p.auth_user_id
      )
    order by p.role, p.display_name
  `)) as unknown as {
    id: string;
    display_name: string;
    role: string;
    email: string;
    auth_user_id: string;
  }[];

  console.log(`孤児プロファイル: ${orphans.length} 件`);
  for (const o of orphans) {
    console.log(
      `  [${o.role}] ${o.display_name} <${o.email}> auth_user_id=${o.auth_user_id}`,
    );
  }

  if (orphans.length === 0) {
    console.log("✓ 孤児なし (auth.users と整合)");
    process.exit(0);
  }

  if (fix) {
    const res = (await db.execute(sql`
      update public.profiles
      set auth_user_id = null, updated_at = now()
      where auth_user_id is not null
        and not exists (
          select 1 from auth.users u where u.id = public.profiles.auth_user_id
        )
      returning id
    `)) as unknown as { id: string }[];
    console.log(
      `✓ ${res.length} 件を未連携(stub)へ戻しました。/admin/tutors の「招待」から再連携できます。`,
    );
    process.exit(0);
  }

  console.error(
    "✗ 孤児あり。`tsx scripts/check-auth-orphans.ts --fix` で未連携へ戻せます。",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
