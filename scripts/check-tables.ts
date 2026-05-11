import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  const result = await db.execute(
    sql`select table_name from information_schema.tables where table_schema='public' order by table_name`,
  );
  console.log("Tables in public schema:");
  for (const r of result as unknown as { table_name: string }[]) {
    console.log("  -", r.table_name);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
