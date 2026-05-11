import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

const email = process.argv[2] ?? "hikaruken0126@gmail.com";
const password = process.argv[3] ?? "hikaru0708";

async function main() {
  const rows = (await db.execute(
    sql`select email,
               encrypted_password = crypt(${password}, encrypted_password) as matches,
               encrypted_password
        from auth.users
        where email = ${email}`,
  )) as unknown as { email: string; matches: boolean; encrypted_password: string }[];

  if (rows.length === 0) {
    console.log("No user found");
    process.exit(1);
  }
  console.log(`Password "${password}" matches: ${rows[0].matches}`);
  console.log(`Hash: ${rows[0].encrypted_password}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
