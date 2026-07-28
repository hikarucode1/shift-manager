import "server-only";
import { and, arrayContains, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";

/**
 * 与えた profile id のうち「tutor ロールを持たない」ものを返す (#165)。
 * シフト取り込み (upload-commit) と講習コマ確定 (saveCourseConfirmations) の
 * 割当先が講師アカウントかを検証するための共通ヘルパー。
 *
 * is_active は敢えて見ない (#171 の確定判断): マッピング/選択 UI が既に active な
 * 講師しか提示するため選択時点で担保され、ここで is_active 必須にすると
 * 「選択後〜保存の間に 1 名無効化されただけで全体が保存不能」の弊害が大きい。
 */
export async function findNonTutorIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        inArray(profiles.id, unique),
        arrayContains(profiles.roles, ["tutor"]),
      ),
    );
  const tutorIds = new Set(rows.map((r) => r.id));
  return unique.filter((id) => !tutorIds.has(id));
}
