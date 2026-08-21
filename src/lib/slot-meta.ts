import "server-only";
import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { slotDefinitions } from "@/db/schema";
import { DEFAULT_SLOTS } from "@/lib/shift-constants";

export type SlotMeta = { label: string; start: string; end: string };

/**
 * "HH:MM" に正規化する。
 *
 * ⚠️ `slot_definitions.start_time` / `end_time` は **text 型で CHECK 制約が無く、
 * アプリ側に書き込み経路も無い** (投入は README の SQL 手打ちのみ)。ゼロ埋めを
 * 忘れて `"9:30"` が入ると、**文字列比較の `isSlotPast` が常に false になり
 * そのコマだけガードが丸ごと無効**になる (#178 のレビュー指摘)。秒付き
 * `"16:30:00"` も切り落とす。
 */
function hhmm(raw: string): string {
  const [h = "", m = ""] = raw.split(":");
  return h === "" ? "" : `${h.padStart(2, "0")}:${m.padStart(2, "0").slice(0, 2)}`;
}

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
          start: hhmm(s.startTime),
          end: hhmm(s.endTime),
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
