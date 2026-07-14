"use server";

import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  fixedShifts,
  fixedShiftSubmissions,
  regularShiftPeriods,
} from "@/db/schema";

// 日曜は教室休校 (Issue #56) のため入力対象外。サーバ側でも拒否する。
// 'no' は「行不在」で表現するため Entry には含めない (Issue #55)。
const EntrySchema = z.object({
  weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat"]),
  slotNumber: z.number().int().min(1).max(20),
  availability: z.enum(["yes", "maybe"]),
});

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const InputSchema = z
  .object({
    effectiveFrom: IsoDate,
    // Issue #58: 有効期間の終わり (任意, null可)
    effectiveTo: IsoDate.nullable().optional(),
    // Issue #57: 希望出勤日数 / コマ数 (任意)
    desiredDays: z.number().int().min(0).max(31).nullable().optional(),
    desiredSlots: z.number().int().min(0).max(200).nullable().optional(),
    // Issue #59: フリースペース (任意, 文字数上限)
    note: z.string().max(1000).nullable().optional(),
    entries: z.array(EntrySchema).max(200),
  })
  .refine(
    (v) =>
      v.effectiveTo == null || v.effectiveTo >= v.effectiveFrom,
    { message: "適用終了日は適用開始日以降である必要があります。", path: ["effectiveTo"] },
  );

export type SaveFixedShiftsResult =
  | { ok: true }
  | { ok: false; error: string };

export type SubmitFixedShiftsResult =
  | { ok: true; submittedAt: string }
  | { ok: false; error: string };

export type RevertSubmissionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Issue #61 / #72 (β): 紐付き期 (regular_shift_periods) の状態判定。
 * - 期間なし: 制約なし (アドホック提出)
 * - 期間あり + opens > now: 開始前 (講師アクション拒否)
 * - 期間あり + opens <= now <= due: 受付中
 * - 期間あり + now > due: 締切後 (講師アクション拒否)
 *
 * 境界: `now > dueAt` (排他)、`opensAt > now` (排他)。`now === opensAt` および
 * `now === dueAt` は受付中扱い。PR #66 の `submissionStatus()` の閉区間判定と整合。
 *
 * 注: `submissions.periodId` を JOIN しないのは、保存時 period 未作成→後から
 * admin が作成したケースを取りこぼさないため。常に effective_from を含む期を
 * 再探索する。期は日付単位 (start_date / end_date) なので、effective_from が
 * 範囲内の active な期 1 件 (期初降順、最新優先) を選ぶ。
 */
/**
 * Issue #156: 現在受付中の期 (submissionOpensAt <= now <= submissionDueAt) を
 * 1 件 (期初降順) 返す。page.tsx の activePeriod 解決と同じ条件。
 *
 * 保存の起点 (effective_from) をサーバ側で期の開始日に強制するために使う。
 * クライアントの effectiveFrom は disabled 属性のみでは改竄可能なので信頼せず、
 * submitFixedShifts の B-2 と同じくサーバ導出に統一する。
 */
async function fetchActiveAcceptingPeriod(
  now: Date,
): Promise<{ id: string; startDate: string } | null> {
  const rows = await db
    .select({
      id: regularShiftPeriods.id,
      startDate: regularShiftPeriods.startDate,
    })
    .from(regularShiftPeriods)
    .where(
      and(
        eq(regularShiftPeriods.isArchived, false),
        lte(regularShiftPeriods.submissionOpensAt, now),
        gte(regularShiftPeriods.submissionDueAt, now),
      ),
    )
    .orderBy(desc(regularShiftPeriods.startDate))
    .limit(1);
  return rows[0] ?? null;
}

async function fetchPeriodWindow(
  effectiveFrom: string,
  now: Date,
): Promise<{
  periodId: string | null;
  isBeforeOpen: boolean;
  isOverDue: boolean;
}> {
  const rows = await db
    .select({
      id: regularShiftPeriods.id,
      submissionOpensAt: regularShiftPeriods.submissionOpensAt,
      submissionDueAt: regularShiftPeriods.submissionDueAt,
    })
    .from(regularShiftPeriods)
    .where(
      and(
        eq(regularShiftPeriods.isArchived, false),
        lte(regularShiftPeriods.startDate, effectiveFrom),
        gte(regularShiftPeriods.endDate, effectiveFrom),
      ),
    )
    .orderBy(desc(regularShiftPeriods.startDate))
    .limit(1);
  const p = rows[0];
  if (!p) return { periodId: null, isBeforeOpen: false, isOverDue: false };
  return {
    periodId: p.id,
    isBeforeOpen: now < p.submissionOpensAt,
    isOverDue: now > p.submissionDueAt,
  };
}

export async function saveFixedShifts(
  input: unknown,
): Promise<SaveFixedShiftsResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "入力値が正しくありません。" };
  }
  const {
    effectiveTo = null,
    desiredDays = null,
    desiredSlots = null,
    note = null,
    entries,
  } = parsed.data;

  const { profile } = await requireRole("tutor");
  const now = new Date();

  // Issue #156: 受付中の期があれば、起点はサーバ側で期の開始日に強制する。
  // クライアント (disabled でも改竄可能) の effectiveFrom を信頼して期の途中日で
  // 保存すると、復元 (page.tsx の期初厳密一致) から漏れた孤児行ができ、admin の
  // submissionByTutor が「同月内で最大 effectiveFrom の行」を採る都合で表示と実体が
  // ねじれる。起点を期初に固定すれば delete-forward で孤児も掃除される。
  const activePeriod = await fetchActiveAcceptingPeriod(now);
  const effectiveFrom = activePeriod
    ? activePeriod.startDate
    : parsed.data.effectiveFrom;

  // effectiveFrom をサーバ側で上書きした結果、任意入力の effectiveTo が起点より前に
  // なる改竄ケースを弾く (通常 UI では min=effectiveFrom で防いでいる)。
  if (effectiveTo != null && effectiveTo < effectiveFrom) {
    return {
      ok: false,
      error: "適用終了日は適用開始日以降である必要があります。",
    };
  }

  // Issue #61 / R-1: 紐付き period の開始前・締切後は保存も拒否。これは period 側の
  // 確認なので transaction の外でやって問題ない (period の状態を保存中にロックする
  // 必要はなく、変わったら次の save で再チェックされる)。
  const { periodId, isBeforeOpen, isOverDue } = await fetchPeriodWindow(
    effectiveFrom,
    now,
  );
  if (isBeforeOpen) {
    return {
      ok: false,
      error: "提出受付の開始前です。教室長が提出期間を開放するまでお待ちください。",
    };
  }
  if (isOverDue) {
    return {
      ok: false,
      error: "提出締切を過ぎているため保存できません。教室長に連絡してください。",
    };
  }

  // PR #67 Round 3 P1-1: 状態チェックと delete を 1 transaction にまとめ、
  // SELECT ... FOR UPDATE で対象範囲の行をロックする。これにより、
  // 「state check 通過 → 別リクエストが draft を submitted/frozen に遷移
  //  → 本 save が delete でその行を消す」競合を遮断する。submit/revert 側は
  // 同じ行に対する UPDATE で行ロック待ちになり、本 transaction が commit して
  // delete 済みになった行への UPDATE は WHERE で 0 件となり安全に弾かれる。
  type SaveOutcome = { kind: "ok" } | { kind: "blocked"; status: "submitted" | "frozen" };
  let outcome: SaveOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      // gte スコープの既存提出行をロック。draft 以外があれば save 不可。
      const existing = await tx
        .select({ status: fixedShiftSubmissions.status })
        .from(fixedShiftSubmissions)
        .where(
          and(
            eq(fixedShiftSubmissions.tutorId, profile.id),
            gte(fixedShiftSubmissions.effectiveFrom, effectiveFrom),
          ),
        )
        .for("update");
      const blocker = existing.find(
        (r) => r.status === "submitted" || r.status === "frozen",
      );
      if (blocker) {
        // SELECT のみで return すれば transaction は commit (no-op) し、ロックも解放
        return {
          kind: "blocked" as const,
          status: blocker.status as "submitted" | "frozen",
        };
      }

      // 今後分 (effectiveFrom 以降) の既存レコードを削除し、今回の内容で置換。
      // shifts とメタを同じスコープで揃えないと、将来分の古いメタが孤立する (#65 P2)。
      await tx
        .delete(fixedShifts)
        .where(
          and(
            eq(fixedShifts.tutorId, profile.id),
            gte(fixedShifts.effectiveFrom, effectiveFrom),
          ),
        );
      await tx
        .delete(fixedShiftSubmissions)
        .where(
          and(
            eq(fixedShiftSubmissions.tutorId, profile.id),
            gte(fixedShiftSubmissions.effectiveFrom, effectiveFrom),
          ),
        );

      if (entries.length > 0) {
        await tx.insert(fixedShifts).values(
          entries.map((e) => ({
            tutorId: profile.id,
            weekday: e.weekday,
            slotNumber: e.slotNumber,
            effectiveFrom,
            availability: e.availability,
          })),
        );
      }

      // 提出単位メタ (Issue #57/#58/#59) を insert (直前に同スコープを delete 済)。
      // effective_to は entries が空でも保持されるよう submissions 側に寄せている。
      // R-3: 監査ログ用に lastStatusChangedAt/_by を初期書き込み (この save 自体が状態作成イベント)
      const trimmedNote = note?.trim() ? note.trim() : null;
      await tx.insert(fixedShiftSubmissions).values({
        tutorId: profile.id,
        effectiveFrom,
        effectiveTo,
        desiredDays,
        desiredSlots,
        note: trimmedNote,
        periodId,
        lastStatusChangedAt: now,
        lastStatusChangedBy: profile.id,
        // status は default 'draft'
      });
      return { kind: "ok" as const };
    });
  } catch (err) {
    console.error("saveFixedShifts failed", err);
    return { ok: false, error: "保存に失敗しました。時間をおいて再度お試しください。" };
  }

  if (outcome.kind === "blocked") {
    if (outcome.status === "submitted") {
      return {
        ok: false,
        error: "既に提出済みです。修正するには「下書きに戻す」を押してください。",
      };
    }
    return {
      ok: false,
      error: "この提出は凍結されています。教室長に解除を依頼してください。",
    };
  }

  revalidatePath("/tutor/fixed-shifts");
  return { ok: true };
}

/**
 * Issue #61: draft → submitted 遷移。
 *
 * B-2: クライアントからの effectiveFrom 受け取りを廃止。サーバ側で「該当 tutor の
 * 最新 draft 行」を自己解決して submit する。これにより、tutor が画面上の
 * effectiveFrom を改竄して任意の未来/archived 月を submitted 化する経路を遮断する。
 *
 * B-1: UPDATE WHERE に `status='draft'` 条件を含め、`returning` の空チェックで
 * 「読み取り時に draft → UPDATE 実行直前に submitted/frozen に書き換わっていた」
 * ケースを検出する。状態列の遷移を必ず draft 起点に絞ることでロック相当の防御に
 * している (PK は `(tutorId, effectiveFrom)` で `updatedAt` は判定に使わない)。
 */
export async function submitFixedShifts(): Promise<SubmitFixedShiftsResult> {
  const { profile } = await requireRole("tutor");
  const now = new Date();

  // 該当 tutor の最新 draft 行 (effectiveFrom 降順) を 1 件取得。
  const rows = await db
    .select({
      effectiveFrom: fixedShiftSubmissions.effectiveFrom,
      status: fixedShiftSubmissions.status,
      desiredDays: fixedShiftSubmissions.desiredDays,
      desiredSlots: fixedShiftSubmissions.desiredSlots,
      note: fixedShiftSubmissions.note,
      effectiveTo: fixedShiftSubmissions.effectiveTo,
    })
    .from(fixedShiftSubmissions)
    .where(eq(fixedShiftSubmissions.tutorId, profile.id))
    .orderBy(desc(fixedShiftSubmissions.effectiveFrom))
    .limit(1);
  const current = rows[0];
  if (!current) {
    return {
      ok: false,
      error: "提出データがまだ保存されていません。先に「保存」してください。",
    };
  }
  if (current.status === "submitted") {
    return { ok: false, error: "既に提出済みです。" };
  }
  if (current.status === "frozen") {
    return {
      ok: false,
      error: "この提出は凍結されています。教室長に解除を依頼してください。",
    };
  }

  // PR #67 P2: 空の submit を拒否。コマ選択もメタ入力も無い状態で submitted 行が
  // 作られると、教室長側の確定フローで「提出済みだが中身なし」の判別が困難になる。
  const entryCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fixedShifts)
    .where(
      and(
        eq(fixedShifts.tutorId, profile.id),
        eq(fixedShifts.effectiveFrom, current.effectiveFrom),
      ),
    );
  const hasEntries = (entryCountRows[0]?.count ?? 0) > 0;
  const hasMeta =
    current.desiredDays != null ||
    current.desiredSlots != null ||
    current.effectiveTo != null ||
    (current.note != null && current.note.trim() !== "");
  if (!hasEntries && !hasMeta) {
    return {
      ok: false,
      error: "提出内容が空です。コマの選択か希望日数等の入力を行ってから提出してください。",
    };
  }

  const { isBeforeOpen, isOverDue } = await fetchPeriodWindow(
    current.effectiveFrom,
    now,
  );
  if (isBeforeOpen) {
    return { ok: false, error: "提出受付の開始前です。" };
  }
  if (isOverDue) {
    return { ok: false, error: "提出締切を過ぎているため提出できません。" };
  }

  // B-1: status='draft' を WHERE に含め returning で空チェック。状態列が draft で
  // ないまま遷移する race / 改竄を遮断する。
  const updated = await db
    .update(fixedShiftSubmissions)
    .set({
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
      lastStatusChangedAt: now,
      lastStatusChangedBy: profile.id,
    })
    .where(
      and(
        eq(fixedShiftSubmissions.tutorId, profile.id),
        eq(fixedShiftSubmissions.effectiveFrom, current.effectiveFrom),
        eq(fixedShiftSubmissions.status, "draft"),
      ),
    )
    .returning({ submittedAt: fixedShiftSubmissions.submittedAt });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "状態が変わりました。ページを再読込してください。",
    };
  }

  revalidatePath("/tutor/fixed-shifts");
  // R-5: クライアントの new Date() ではなくサーバが実際に書いた値を返す
  return { ok: true, submittedAt: updated[0].submittedAt!.toISOString() };
}

/**
 * Issue #61: submitted → draft 遷移 (講師による下書き化)。
 * 締切前のみ実行可能。frozen は admin の介入が必要なため対象外。
 *
 * B-2: クライアントからの effectiveFrom 受け取りを廃止。サーバ側で「該当 tutor の
 * 最新 submitted 行」を自己解決する。
 * B-1: UPDATE WHERE に `status='submitted'` を含め returning で空チェック。
 */
export async function revertSubmissionToDraft(): Promise<RevertSubmissionResult> {
  const { profile } = await requireRole("tutor");
  const now = new Date();

  const rows = await db
    .select({
      effectiveFrom: fixedShiftSubmissions.effectiveFrom,
      status: fixedShiftSubmissions.status,
    })
    .from(fixedShiftSubmissions)
    .where(eq(fixedShiftSubmissions.tutorId, profile.id))
    .orderBy(desc(fixedShiftSubmissions.effectiveFrom))
    .limit(1);
  const current = rows[0];
  if (!current) {
    return { ok: false, error: "対象の提出が見つかりません。" };
  }
  if (current.status === "draft") {
    return { ok: false, error: "既に下書き状態です。" };
  }
  if (current.status === "frozen") {
    return {
      ok: false,
      error: "凍結状態を講師から解除することはできません。教室長に依頼してください。",
    };
  }

  const { isOverDue } = await fetchPeriodWindow(current.effectiveFrom, now);
  if (isOverDue) {
    return {
      ok: false,
      error: "提出締切を過ぎているため下書きに戻せません。",
    };
  }

  const updated = await db
    .update(fixedShiftSubmissions)
    .set({
      status: "draft",
      submittedAt: null,
      updatedAt: now,
      lastStatusChangedAt: now,
      lastStatusChangedBy: profile.id,
    })
    .where(
      and(
        eq(fixedShiftSubmissions.tutorId, profile.id),
        eq(fixedShiftSubmissions.effectiveFrom, current.effectiveFrom),
        eq(fixedShiftSubmissions.status, "submitted"),
      ),
    )
    .returning({ effectiveFrom: fixedShiftSubmissions.effectiveFrom });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "状態が変わりました。ページを再読込してください。",
    };
  }

  revalidatePath("/tutor/fixed-shifts");
  return { ok: true };
}
