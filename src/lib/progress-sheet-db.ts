import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { PROGRESS_SHEET_KEY } from "@/lib/progress-sheet";

/** #339: 登録されている進行表の URL。未登録なら null */
export async function getProgressSheetUrl(): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROGRESS_SHEET_KEY))
    .limit(1);
  return row?.value ?? null;
}
