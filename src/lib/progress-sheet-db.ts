import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { SHEET_LINKS, type SheetLinkKind } from "@/lib/progress-sheet";

/** 登録されているスプレッドシートの URL (進行表・講師マニュアル)。未登録なら null */
export async function getSheetLinkUrl(
  kind: SheetLinkKind,
): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SHEET_LINKS[kind].key))
    .limit(1);
  return row?.value ?? null;
}

/** #339: 登録されている進行表の URL。未登録なら null */
export function getProgressSheetUrl(): Promise<string | null> {
  return getSheetLinkUrl("progress");
}

/** 室長レビュー要望13: 登録されている講師マニュアルの URL。未登録なら null */
export function getTutorManualUrl(): Promise<string | null> {
  return getSheetLinkUrl("manual");
}
