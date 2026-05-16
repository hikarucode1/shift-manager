import "server-only";
import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { slotDefinitions } from "@/db/schema";
import { DEFAULT_SLOTS } from "@/lib/shift-constants";

export type SlotMeta = { label: string; start: string; end: string };

/**
 * 有効なコマ定義を slot_number → {label,start,end} の Map で返す。
 * コマ定義は不変なので 1 リクエスト内でキャッシュ
 * (今週/来週・全講師など複数回呼ばれても 1 クエリで済む)。
 * slot_definitions が未投入なら DEFAULT_SLOTS にフォールバック。
 */
export const getSlotMeta = cache(async (): Promise<Map<number, SlotMeta>> => {
  const rows = await db
    .select()
    .from(slotDefinitions)
    .where(eq(slotDefinitions.isActive, true))
    .orderBy(asc(slotDefinitions.slotNumber));

  const source =
    rows.length > 0
      ? rows.map((s) => ({
          slotNumber: s.slotNumber,
          label: s.label,
          start: s.startTime,
          end: s.endTime,
        }))
      : DEFAULT_SLOTS.map((s) => ({
          slotNumber: s.slotNumber,
          label: s.label,
          start: s.startTime,
          end: s.endTime,
        }));

  const map = new Map<number, SlotMeta>();
  for (const s of source) {
    map.set(s.slotNumber, { label: s.label, start: s.start, end: s.end });
  }
  return map;
});

/** UI で全コマ行を出すための番号一覧 (slotMeta のキーを昇順で) */
export function slotNumbers(meta: Map<number, SlotMeta>): number[] {
  return [...meta.keys()].sort((a, b) => a - b);
}
