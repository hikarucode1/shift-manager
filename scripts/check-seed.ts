import { asc } from "drizzle-orm";
import { db } from "../src/db/client";
import { profiles, slotDefinitions } from "../src/db/schema";

async function main() {
  console.log("=== slot_definitions ===");
  const slots = await db
    .select()
    .from(slotDefinitions)
    .orderBy(asc(slotDefinitions.slotNumber));
  for (const s of slots) {
    console.log(`  ${s.slotNumber}限  ${s.startTime}〜${s.endTime}  (active: ${s.isActive})`);
  }

  console.log("\n=== profiles ===");
  const ps = await db.select().from(profiles).orderBy(asc(profiles.role), asc(profiles.displayName));
  for (const p of ps) {
    console.log(`  [${p.role}] ${p.displayName}  <${p.email}>  active: ${p.isActive}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
