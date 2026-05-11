import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  const rows = (await db.execute(
    sql`select email, substring(encrypted_password, 1, 30) as hash_prefix, length(encrypted_password) as hash_len
        from auth.users
        order by created_at`,
  )) as unknown as { email: string; hash_prefix: string; hash_len: number }[];

  for (const r of rows) {
    console.log(`${r.email}`);
    console.log(`  hash prefix: ${r.hash_prefix}...`);
    console.log(`  hash length: ${r.hash_len}`);
  }

  // Available crypto extensions / functions
  const ext = await db.execute(
    sql`select extname from pg_extension where extname in ('pgcrypto','pgsodium')`,
  );
  console.log("\nExtensions:", (ext as unknown as { extname: string }[]).map((e) => e.extname));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
