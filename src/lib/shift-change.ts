import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  fixedShiftSubmissions,
  fixedShifts,
  periods,
  profiles,
  regularShiftPeriods,
  shiftChangeRequests,
  type RegularSnapshot,
} from "@/db/schema";
import { isGrantActive } from "@/lib/shift-change-rule";

/**
 * #333: 提出期間外の変更申請 (DB 側)。承認されると `unlocked_until` まで
 * その講師だけ編集できる。
 */

export type ChangeRequestState =
  | { kind: "none" }
  | { kind: "pending"; id: string; createdAt: Date }
  | { kind: "approved"; id: string; unlockedUntil: Date }
  | { kind: "rejected"; id: string; decisionNote: string | null };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * レギュラーの承認時: 範囲内の提出 (メタ + コマ) を丸ごと控える。
 * 期限切れのときに {@link restoreRegularSnapshot} で戻す
 */
export async function takeRegularSnapshot(
  tx: Tx,
  tutorId: string,
  scope: { from: string; to: string } | null,
): Promise<RegularSnapshot> {
  if (!scope) return { scope: null, submissions: [], shifts: [] };
  const inScope = <C extends typeof fixedShifts.effectiveFrom | typeof fixedShiftSubmissions.effectiveFrom>(c: C) =>
    and(gte(c, scope.from), lte(c, scope.to));
  // 同じ transaction の中なので順に読む
  const subs = await tx
      .select()
      .from(fixedShiftSubmissions)
      .where(
        and(
          eq(fixedShiftSubmissions.tutorId, tutorId),
          inScope(fixedShiftSubmissions.effectiveFrom),
        ),
      );
  const shifts = await tx
    .select()
    .from(fixedShifts)
    .where(
      and(eq(fixedShifts.tutorId, tutorId), inScope(fixedShifts.effectiveFrom)),
    );
  return {
    scope,
    submissions: subs.map((r) => ({
      ...r,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      lastStatusChangedAt: r.lastStatusChangedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    shifts: shifts.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}

function inSnapScope(
  snap: RegularSnapshot,
  c: typeof fixedShifts.effectiveFrom | typeof fixedShiftSubmissions.effectiveFrom,
) {
  return snap.scope
    ? and(gte(c, snap.scope.from), lte(c, snap.scope.to))
    : undefined;
}

/**
 * 期限までに出し直さなかったレギュラーを、承認前の状態に戻す (直しかけの下書きは捨てる)。
 * 期の無い許可で範囲外の日付に作った下書きも消す。承認のあとに提出・凍結された行が
 * あれば (提出期間が始まって普通に出した等)、それを消さないよう何もしない
 */
async function restoreRegularSnapshot(
  tx: Tx,
  tutorId: string,
  snap: RegularSnapshot,
  decidedAt: Date,
) {
  const touched = await tx
    .select({
      effectiveFrom: fixedShiftSubmissions.effectiveFrom,
      status: fixedShiftSubmissions.status,
    })
    .from(fixedShiftSubmissions)
    .where(
      and(
        eq(fixedShiftSubmissions.tutorId, tutorId),
        or(
          // 期の無い許可で、範囲外の日付に作った下書き
          and(
            gte(fixedShiftSubmissions.lastStatusChangedAt, decidedAt),
            isNull(fixedShiftSubmissions.periodId),
          ),
          inSnapScope(snap, fixedShiftSubmissions.effectiveFrom),
        ),
      ),
    )
    .for("update");
  if (touched.some((r) => r.status !== "draft")) return;
  const dates = touched.map((r) => r.effectiveFrom);
  // 条件が空だと講師の全行を消してしまうので、消す範囲が無ければ何もしない
  if (!snap.scope && dates.length === 0) return;
  const inScopeOr = <C extends typeof fixedShifts.effectiveFrom | typeof fixedShiftSubmissions.effectiveFrom>(c: C) =>
    or(
      inSnapScope(snap, c),
      dates.length > 0 ? inArray(c, dates) : undefined,
    );
  await tx
    .delete(fixedShifts)
    .where(
      and(eq(fixedShifts.tutorId, tutorId), inScopeOr(fixedShifts.effectiveFrom)),
    );
  await tx
    .delete(fixedShiftSubmissions)
    .where(
      and(
        eq(fixedShiftSubmissions.tutorId, tutorId),
        inScopeOr(fixedShiftSubmissions.effectiveFrom),
      ),
    );
  if (snap.submissions.length > 0) {
    await tx.insert(fixedShiftSubmissions).values(
      snap.submissions.map((r) => ({
        ...r,
        submittedAt: r.submittedAt ? new Date(r.submittedAt) : null,
        lastStatusChangedAt: r.lastStatusChangedAt
          ? new Date(r.lastStatusChangedAt)
          : null,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
      })),
    );
  }
  if (snap.shifts.length > 0) {
    await tx
      .insert(fixedShifts)
      .values(snap.shifts.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })));
  }
}

/**
 * 期限の切れた承認を閉じる。部分 unique index (申請中 + 承認中で 1 件) が
 * 期限切れの行で埋まって、次の申請が出せなくなるのを防ぐ。
 * レギュラーは出し直さないまま切れたら、下書きを捨てて承認前に戻す。
 * tutorId を省くと全員分。画面を開いたときに呼ぶ (定期実行が無いため)
 */
export async function closeExpiredGrants(tutorId: string | null, now: Date) {
  const expired = await db
    .select({ id: shiftChangeRequests.id })
    .from(shiftChangeRequests)
    .where(
      and(
        tutorId ? eq(shiftChangeRequests.tutorId, tutorId) : undefined,
        eq(shiftChangeRequests.status, "approved"),
        lt(shiftChangeRequests.unlockedUntil, now),
      ),
    );
  for (const { id } of expired) {
    try {
      await db.transaction(async (tx) => {
        // 閉じるのと戻すのを 1 つにまとめ、同時に開いた 2 画面で二重に戻さない
        const [row] = await tx
          .update(shiftChangeRequests)
          .set({ status: "closed", closedAt: now })
          .where(
            and(
              eq(shiftChangeRequests.id, id),
              eq(shiftChangeRequests.status, "approved"),
              lt(shiftChangeRequests.unlockedUntil, now),
            ),
          )
          .returning({
            tutorId: shiftChangeRequests.tutorId,
            kind: shiftChangeRequests.kind,
            decidedAt: shiftChangeRequests.decidedAt,
            snapshot: shiftChangeRequests.regularSnapshot,
          });
        if (row?.kind === "regular" && row.snapshot && row.decidedAt) {
          await restoreRegularSnapshot(
            tx,
            row.tutorId,
            row.snapshot,
            row.decidedAt,
          );
        }
      });
    } catch (e) {
      console.error("closeExpiredGrants failed", id, e);
    }
  }
}

/** 今使える (承認済み・期限内の) レギュラーの許可 */
export async function getActiveRegularGrant(
  tutorId: string,
  now: Date,
): Promise<{
  id: string;
  regularPeriodId: string | null;
  unlockedUntil: Date;
} | null> {
  const rows = await db
    .select({
      id: shiftChangeRequests.id,
      regularPeriodId: shiftChangeRequests.regularPeriodId,
      status: shiftChangeRequests.status,
      unlockedUntil: shiftChangeRequests.unlockedUntil,
    })
    .from(shiftChangeRequests)
    .where(
      and(
        eq(shiftChangeRequests.tutorId, tutorId),
        eq(shiftChangeRequests.kind, "regular"),
        eq(shiftChangeRequests.status, "approved"),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r || !isGrantActive(r, now)) return null;
  return {
    id: r.id,
    regularPeriodId: r.regularPeriodId,
    unlockedUntil: r.unlockedUntil!,
  };
}

/** 今使える講習の許可 (その期間の分) */
export async function getActiveTrainingGrant(
  tutorId: string,
  trainingPeriodId: string,
  now: Date,
): Promise<{ id: string; unlockedUntil: Date } | null> {
  const rows = await db
    .select({
      id: shiftChangeRequests.id,
      status: shiftChangeRequests.status,
      unlockedUntil: shiftChangeRequests.unlockedUntil,
    })
    .from(shiftChangeRequests)
    .where(
      and(
        eq(shiftChangeRequests.tutorId, tutorId),
        eq(shiftChangeRequests.kind, "training"),
        eq(shiftChangeRequests.trainingPeriodId, trainingPeriodId),
        eq(shiftChangeRequests.status, "approved"),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r || !isGrantActive(r, now)) return null;
  return { id: r.id, unlockedUntil: r.unlockedUntil! };
}

type StateRow = {
  id: string;
  status: "pending" | "approved" | "rejected" | "closed";
  unlockedUntil: Date | null;
  decisionNote: string | null;
  createdAt: Date;
};

/** いちばん新しい申請から、講師の画面に出す状態を決める */
function toState(rows: StateRow[], now: Date): ChangeRequestState {
  const r = rows[0];
  if (!r) return { kind: "none" };
  if (r.status === "pending")
    return { kind: "pending", id: r.id, createdAt: r.createdAt };
  if (isGrantActive(r, now))
    return { kind: "approved", id: r.id, unlockedUntil: r.unlockedUntil! };
  if (r.status === "rejected")
    return { kind: "rejected", id: r.id, decisionNote: r.decisionNote };
  return { kind: "none" };
}

const stateColumns = {
  id: shiftChangeRequests.id,
  status: shiftChangeRequests.status,
  unlockedUntil: shiftChangeRequests.unlockedUntil,
  decisionNote: shiftChangeRequests.decisionNote,
  createdAt: shiftChangeRequests.createdAt,
};

export async function getRegularChangeState(
  tutorId: string,
  now: Date,
): Promise<ChangeRequestState> {
  const rows = await db
    .select(stateColumns)
    .from(shiftChangeRequests)
    .where(
      and(
        eq(shiftChangeRequests.tutorId, tutorId),
        eq(shiftChangeRequests.kind, "regular"),
      ),
    )
    .orderBy(desc(shiftChangeRequests.createdAt))
    .limit(1);
  return toState(rows, now);
}

/** 講習期間ごとの状態 (講習の画面で期間ごとに出す) */
export async function getTrainingChangeStates(
  tutorId: string,
  trainingPeriodIds: string[],
  now: Date,
): Promise<Map<string, ChangeRequestState>> {
  const out = new Map<string, ChangeRequestState>();
  if (trainingPeriodIds.length === 0) return out;
  const rows = await db
    .select({
      ...stateColumns,
      trainingPeriodId: shiftChangeRequests.trainingPeriodId,
    })
    .from(shiftChangeRequests)
    .where(
      and(
        eq(shiftChangeRequests.tutorId, tutorId),
        eq(shiftChangeRequests.kind, "training"),
        inArray(shiftChangeRequests.trainingPeriodId, trainingPeriodIds),
      ),
    )
    .orderBy(desc(shiftChangeRequests.createdAt));
  const byPeriod = new Map<string, StateRow[]>();
  for (const r of rows) {
    const k = r.trainingPeriodId!;
    byPeriod.set(k, [...(byPeriod.get(k) ?? []), r]);
  }
  for (const id of trainingPeriodIds) {
    out.set(id, toState(byPeriod.get(id) ?? [], now));
  }
  return out;
}

/** 許可を閉じる (出し直した / 終えた)。閉じた行があれば true */
export async function closeGrant(id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(shiftChangeRequests)
    .set({ status: "closed", closedAt: now })
    .where(
      and(
        eq(shiftChangeRequests.id, id),
        eq(shiftChangeRequests.status, "approved"),
      ),
    )
    .returning({ id: shiftChangeRequests.id });
  return rows.length > 0;
}

export type PendingChangeRequest = {
  id: string;
  tutorName: string;
  kind: "regular" | "training";
  /** 期の名前。レギュラーで期が 1 つも無いときは null */
  targetLabel: string | null;
  reason: string;
  createdAt: Date;
};

/** 教室長の画面: 承認待ちの変更申請 (古い順) */
export async function getPendingChangeRequests(): Promise<
  PendingChangeRequest[]
> {
  const rows = await db
    .select({
      id: shiftChangeRequests.id,
      tutorName: profiles.displayName,
      kind: shiftChangeRequests.kind,
      regularLabel: regularShiftPeriods.label,
      trainingName: periods.name,
      reason: shiftChangeRequests.reason,
      createdAt: shiftChangeRequests.createdAt,
    })
    .from(shiftChangeRequests)
    .innerJoin(profiles, eq(profiles.id, shiftChangeRequests.tutorId))
    .leftJoin(
      regularShiftPeriods,
      eq(regularShiftPeriods.id, shiftChangeRequests.regularPeriodId),
    )
    .leftJoin(periods, eq(periods.id, shiftChangeRequests.trainingPeriodId))
    .where(eq(shiftChangeRequests.status, "pending"))
    .orderBy(asc(shiftChangeRequests.createdAt));
  return rows.map((r) => ({
    id: r.id,
    tutorName: r.tutorName,
    kind: r.kind,
    targetLabel: r.kind === "regular" ? r.regularLabel : r.trainingName,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}

/** 教室長の講習画面: その講習期間で今だけ編集できる講師 (tutorId → 期限) */
export async function getTrainingGrantsForPeriod(
  trainingPeriodId: string,
  now: Date,
): Promise<Map<string, Date>> {
  const rows = await db
    .select({
      tutorId: shiftChangeRequests.tutorId,
      status: shiftChangeRequests.status,
      unlockedUntil: shiftChangeRequests.unlockedUntil,
    })
    .from(shiftChangeRequests)
    .where(
      and(
        eq(shiftChangeRequests.kind, "training"),
        eq(shiftChangeRequests.trainingPeriodId, trainingPeriodId),
        eq(shiftChangeRequests.status, "approved"),
      ),
    );
  const out = new Map<string, Date>();
  for (const r of rows) {
    if (isGrantActive(r, now)) out.set(r.tutorId, r.unlockedUntil!);
  }
  return out;
}
