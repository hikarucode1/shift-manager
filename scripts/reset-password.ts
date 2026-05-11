import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error("Usage: tsx scripts/reset-password.ts <email> <new-password>");
  process.exit(1);
}

async function main() {
  // Supabase は auth.users.encrypted_password に bcrypt ハッシュを格納
  // pgcrypto の crypt() with gen_salt('bf') が互換
  const updated = (await db.execute(
    sql`update auth.users
        set encrypted_password = crypt(${password}, gen_salt('bf')),
            updated_at = now()
        where email = ${email}
        returning id, email`,
  )) as unknown as { id: string; email: string }[];

  if (updated.length === 0) {
    console.error(`✗ ${email} は auth.users に存在しません`);
    process.exit(1);
  }
  console.log(`✓ Password updated for ${updated[0].email} (id: ${updated[0].id})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
