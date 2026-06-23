"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { periods } from "@/db/schema";
import { isValidIsoDate } from "@/lib/week";

/**
 * 未アーカイブの他期間と「日付レンジ重複」または「同名」が無いか検証。
 * #110 で kind を撤廃し、全期間が講習期間。重複講習期間があると #7（講習希望
 * 提出）で日付がどの期間か一意に決まらない。
 * @returns 問題が無ければ null、あればユーザー向けメッセージ
 *
 * ⚠️ 残存リスク (#26 レビュー PR1, 受容済み):
 * これは SELECT→INSERT/UPDATE の TOCTOU で、DB レベルの制約ではない。
 * 2 管理者が同時に重なる期間を作るとすり抜けうる。期間作成は
 * 「管理者のみ・年数回」の低頻度操作で、当たる確率は実質ゼロ、かつ
 * 一覧で目視検知・後から修正可能なため比例的に受容している。
 * 昇格条件: 期間作成を一般ユーザーへ開放 / 自動生成 / 高頻度化 した場合は
 * Postgres EXCLUDE 制約 (btree_gist + daterange, is_archived 条件付き) で
 * DB レベルに厳密化すること。
 */
async function findPeriodConflict(args: {
  excludeId?: string;
  name: string;
  startDate: string;
  endDate: string;
}): Promise<string | null> {
  const rows = await db
    .select({
      id: periods.id,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
    })
    .from(periods)
    .where(
      and(
        eq(periods.isArchived, false),
        args.excludeId ? ne(periods.id, args.excludeId) : undefined,
      ),
    );

  const sameName = rows.find((r) => r.name === args.name.trim());
  if (sameName) {
    return `同名の講習期間が既にあります（「${sameName.name}」）。名称を変えてください。`;
  }
  // 日付レンジ重複: s1 <= e2 && s2 <= e1
  const overlap = rows.find(
    (r) => args.startDate <= r.endDate && r.startDate <= args.endDate,
  );
  if (overlap) {
    return `期間が「${overlap.name}」（${overlap.startDate}〜${overlap.endDate}）と重複しています。重ならない日付にしてください。`;
  }
  return null;
}

type ActionResult = { ok: true } | { ok: false; error: string };

const isoDate = z
  .string()
  .refine((v) => isValidIsoDate(v), "日付の形式が正しくありません。");

/**
 * 講習期間長 (開始・終了を含む日数) の運用上限。
 * #7 で eachDate により 1 日ずつ展開され、その安全弁が 366 日で頭打ちになる
 * (src/lib/training.ts)。上限を設けないと 1 年超の誤設定で日付が無言で切り捨て
 * られる (#29)。90 日は講習の運用上の最長。
 */
const MAX_PERIOD_DAYS = 90;

/** 開始・終了を含む日数。ISO 日付前提 (UTC 正午基準で DST 無関係)。 */
function periodLengthDays(startIso: string, endIso: string): number {
  const s = Date.parse(`${startIso}T12:00:00.000Z`);
  const e = Date.parse(`${endIso}T12:00:00.000Z`);
  return Math.round((e - s) / 86_400_000) + 1;
}

function periodLengthError(startDate: string, endDate: string): string | null {
  if (periodLengthDays(startDate, endDate) > MAX_PERIOD_DAYS) {
    return `講習期間が長すぎます（最長 ${MAX_PERIOD_DAYS} 日）。日付を見直してください。`;
  }
  return null;
}

/**
 * 講習期間の締切は「その日の終わり (JST 23:59:59.999)」として timestamp 化。
 * 締切当日いっぱい (ミリ秒末まで) を提出可能にするため .999 を含める。
 */
function deadlineToTimestamp(dateIso: string): Date {
  return new Date(`${dateIso}T23:59:59.999+09:00`);
}

const PeriodInput = z
  .object({
    name: z.string().trim().min(1, "名称を入力してください。").max(80),
    startDate: isoDate,
    endDate: isoDate,
    submissionDeadline: isoDate,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "開始日は終了日以前にしてください。",
    path: ["endDate"],
  })
  .refine((v) => v.submissionDeadline <= v.startDate, {
    message: "提出締切日は講習開始日以前にしてください。",
    path: ["submissionDeadline"],
  });

export async function createPeriod(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = PeriodInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const v = parsed.data;

  const lengthError = periodLengthError(v.startDate, v.endDate);
  if (lengthError) return { ok: false, error: lengthError };

  const conflict = await findPeriodConflict({
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
  });
  if (conflict) return { ok: false, error: conflict };

  await db.insert(periods).values({
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
    submissionDeadline: deadlineToTimestamp(v.submissionDeadline),
    createdBy: profile.id,
  });

  revalidatePath("/admin/periods");
  return { ok: true };
}

const UpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "名称を入力してください。").max(80),
  startDate: isoDate,
  endDate: isoDate,
  submissionDeadline: isoDate,
});

export async function updatePeriod(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const v = parsed.data;
  if (v.startDate > v.endDate) {
    return { ok: false, error: "開始日は終了日以前にしてください。" };
  }

  const lengthError = periodLengthError(v.startDate, v.endDate);
  if (lengthError) return { ok: false, error: lengthError };

  if (v.submissionDeadline > v.startDate) {
    return {
      ok: false,
      error: "提出締切日は講習開始日以前にしてください。",
    };
  }

  const conflict = await findPeriodConflict({
    excludeId: v.id,
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
  });
  if (conflict) return { ok: false, error: conflict };

  let updated: { id: string }[] = [];
  try {
    // Issue #104: saveCourseConfirmations と同じ periodId 単位の advisory lock
    // を取得。確定保存 tx が同 period を持っている場合、本 update 完了まで
    // 待たされ、保存側は tx 内 再 SELECT で最新の startDate/endDate/isArchived を
    // 読める。regular_shift_periods 側 (updateRegularPeriod) と同パターン (#89)。
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${v.id}))`);
      updated = await tx
        .update(periods)
        .set({
          name: v.name,
          startDate: v.startDate,
          endDate: v.endDate,
          submissionDeadline: deadlineToTimestamp(v.submissionDeadline),
          updatedAt: new Date(),
        })
        .where(eq(periods.id, v.id))
        .returning({ id: periods.id });
    });
  } catch (err) {
    console.error("updatePeriod failed", err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : null;
    // 0026 trigger: 範囲外 child (course_confirmations.date) が残っているケース。
    if (code === "23514") {
      return {
        ok: false,
        error:
          "期間内に範囲外の確定枠が存在します。先に該当枠を削除してから期間を変更してください。",
      };
    }
    return { ok: false, error: "更新に失敗しました。" };
  }
  if (updated.length === 0) {
    return { ok: false, error: "対象の期間が見つかりません。" };
  }

  revalidatePath("/admin/periods");
  return { ok: true };
}

const ToggleInput = z.object({
  id: z.string().uuid(),
  value: z.boolean(),
});

/** アーカイブ / 復帰 */
export async function setPeriodArchived(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = ToggleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  await db
    .update(periods)
    .set({ isArchived: parsed.data.value, updatedAt: new Date() })
    .where(eq(periods.id, parsed.data.id));

  revalidatePath("/admin/periods");
  return { ok: true };
}

/** 締切後の再開放 / 解除 */
export async function setPeriodReopened(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = ToggleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const updated = await db
    .update(periods)
    .set({ isReopened: parsed.data.value, updatedAt: new Date() })
    .where(eq(periods.id, parsed.data.id))
    .returning({ id: periods.id });
  if (updated.length === 0) {
    return { ok: false, error: "対象の期間が見つかりません。" };
  }

  revalidatePath("/admin/periods");
  return { ok: true };
}
