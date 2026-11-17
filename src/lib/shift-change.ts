import "server-only";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import {
  periods,
  profiles,
  regularShiftPeriods,
  shiftChangeRequests,
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

/**
 * 期限の切れた承認を閉じる。部分 unique index (申請中 + 承認中で 1 件) が
 * 期限切れの行で埋まって、次の申請が出せなくなるのを防ぐ。
 */
export async function closeExpiredGrants(tutorId: string, now: Date) {
  await db
    .update(shiftChangeRequests)
    .set({ status: "closed", closedAt: now })
    .where(
      and(
        eq(shiftChangeRequests.tutorId, tutorId),
        eq(shiftChangeRequests.status, "approved"),
        lt(shiftChangeRequests.unlockedUntil, now),
      ),
    );
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
