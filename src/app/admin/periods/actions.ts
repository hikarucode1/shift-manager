"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { periods, type periodKindEnum } from "@/db/schema";
import { isValidIsoDate } from "@/lib/week";

type PeriodKind = (typeof periodKindEnum.enumValues)[number];

/**
 * 同種別・未アーカイブの他期間と「日付レンジ重複」または「同名」が無いか検証。
 * 重複講習期間があると #7（講習希望提出）で日付がどの期間か一意に決まらない。
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
  kind: PeriodKind;
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
        eq(periods.kind, args.kind),
        eq(periods.isArchived, false),
        args.excludeId ? ne(periods.id, args.excludeId) : undefined,
      ),
    );

  const sameName = rows.find((r) => r.name === args.name.trim());
  if (sameName) {
    return `同名の${args.kind === "training" ? "講習" : "通常"}期間が既にあります（「${sameName.name}」）。名称を変えてください。`;
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
 * 期間長 (開始・終了を含む日数) の運用上限。
 * training は #7 で eachDate により 1 日ずつ展開され、その安全弁が 366 日で
 * 頭打ちになる (src/lib/training.ts)。上限を設けないと 1 年超の誤設定で
 * 日付が無言で切り捨てられる (#29)。90 日は講習の運用上の最長。
 * normal は日次展開しないが、年単位の誤入力 (西暦打ち間違い等) を弾くため緩い上限。
 */
const MAX_PERIOD_DAYS: Record<PeriodKind, number> = {
  training: 90,
  normal: 400,
};

/** 開始・終了を含む日数。ISO 日付前提 (UTC 正午基準で DST 無関係)。 */
function periodLengthDays(startIso: string, endIso: string): number {
  const s = Date.parse(`${startIso}T12:00:00.000Z`);
  const e = Date.parse(`${endIso}T12:00:00.000Z`);
  return Math.round((e - s) / 86_400_000) + 1;
}

function periodLengthError(
  kind: PeriodKind,
  startDate: string,
  endDate: string,
): string | null {
  const max = MAX_PERIOD_DAYS[kind];
  if (periodLengthDays(startDate, endDate) > max) {
    return `${kind === "training" ? "講習" : "通常"}期間が長すぎます（最長 ${max} 日）。日付を見直してください。`;
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
    kind: z.enum(["normal", "training"]),
    name: z.string().trim().min(1, "名称を入力してください。").max(80),
    startDate: isoDate,
    endDate: isoDate,
    /** 講習のみ。normal では無視 */
    submissionDeadline: isoDate.optional().nullable(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "開始日は終了日以前にしてください。",
    path: ["endDate"],
  })
  .refine(
    (v) =>
      v.kind === "normal" ||
      (typeof v.submissionDeadline === "string" &&
        v.submissionDeadline.length > 0),
    { message: "講習期間は提出締切日が必須です。", path: ["submissionDeadline"] },
  )
  .refine(
    (v) =>
      v.kind === "training" ||
      v.submissionDeadline == null ||
      v.submissionDeadline === "",
    { message: "通常期間に締切日は設定できません。", path: ["submissionDeadline"] },
  )
  .refine(
    (v) =>
      v.kind !== "training" ||
      !v.submissionDeadline ||
      v.submissionDeadline <= v.startDate,
    {
      message: "提出締切日は講習開始日以前にしてください。",
      path: ["submissionDeadline"],
    },
  );

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

  const lengthError = periodLengthError(v.kind, v.startDate, v.endDate);
  if (lengthError) return { ok: false, error: lengthError };

  const conflict = await findPeriodConflict({
    kind: v.kind,
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
  });
  if (conflict) return { ok: false, error: conflict };

  await db.insert(periods).values({
    kind: v.kind,
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
    submissionDeadline:
      v.kind === "training" && v.submissionDeadline
        ? deadlineToTimestamp(v.submissionDeadline)
        : null,
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
  submissionDeadline: isoDate.optional().nullable(),
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

  const rows = await db
    .select({ kind: periods.kind })
    .from(periods)
    .where(eq(periods.id, v.id))
    .limit(1);
  if (rows.length === 0) {
    return { ok: false, error: "対象の期間が見つかりません。" };
  }
  const kind = rows[0].kind;

  const lengthError = periodLengthError(kind, v.startDate, v.endDate);
  if (lengthError) return { ok: false, error: lengthError };

  if (kind === "training") {
    if (!(typeof v.submissionDeadline === "string" && v.submissionDeadline)) {
      return { ok: false, error: "講習期間は提出締切日が必須です。" };
    }
    if (v.submissionDeadline > v.startDate) {
      return {
        ok: false,
        error: "提出締切日は講習開始日以前にしてください。",
      };
    }
  }

  const conflict = await findPeriodConflict({
    excludeId: v.id,
    kind,
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
          submissionDeadline:
            kind === "training" && v.submissionDeadline
              ? deadlineToTimestamp(v.submissionDeadline)
              : null,
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

/** 締切後の再開放 / 解除 (講習のみ意味を持つ) */
export async function setPeriodReopened(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = ToggleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const rows = await db
    .select({ kind: periods.kind })
    .from(periods)
    .where(eq(periods.id, parsed.data.id))
    .limit(1);
  if (rows.length === 0) {
    return { ok: false, error: "対象の期間が見つかりません。" };
  }
  if (rows[0].kind !== "training") {
    return { ok: false, error: "通常期間に再開放はありません。" };
  }

  await db
    .update(periods)
    .set({ isReopened: parsed.data.value, updatedAt: new Date() })
    .where(eq(periods.id, parsed.data.id));

  revalidatePath("/admin/periods");
  return { ok: true };
}
