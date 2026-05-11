import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  const rows = await db.execute(
    sql`select id, email, email_confirmed_at, created_at, last_sign_in_at
        from auth.users
        order by created_at`,
  );
  console.log(`=== auth.users (${(rows as unknown[]).length}) ===`);
  for (const u of rows as unknown as {
    id: string;
    email: string;
    email_confirmed_at: string | null;
    created_at: string;
    last_sign_in_at: string | null;
  }[]) {
    const confirmed = u.email_confirmed_at ? "✓ confirmed" : "✗ NOT CONFIRMED";
    const signed = u.last_sign_in_at ? `last signed: ${u.last_sign_in_at}` : "never signed in";
    console.log(`  ${u.email}`);
    console.log(`    id: ${u.id}`);
    console.log(`    ${confirmed}  |  ${signed}`);
  }

  console.log("\n=== profiles cross-check ===");
  const profileMatch = await db.execute(
    sql`select au.email, au.id as auth_id, p.id as profile_id, p.role, p.display_name, p.is_active
        from auth.users au
        left join public.profiles p on p.id = au.id
        order by au.created_at`,
  );
  for (const r of profileMatch as unknown as {
    email: string;
    auth_id: string;
    profile_id: string | null;
    role: string | null;
    display_name: string | null;
    is_active: boolean | null;
  }[]) {
    const status = r.profile_id
      ? `✓ profile (role: ${r.role}, name: ${r.display_name}, active: ${r.is_active})`
      : "✗ NO PROFILE — login will redirect to /login";
    console.log(`  ${r.email}  →  ${status}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
