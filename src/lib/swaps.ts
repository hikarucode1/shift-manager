import "server-only";
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  profiles,
  swapApplications,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { getSlotMeta } from "@/lib/slot-meta";
import { jstToday, weekdayOf } from "@/lib/week";

export type SwapKind = "named" | "open";
export type SwapStatus = "pending" | "approved" | "rejected" | "cancelled";

export type SwappableShift = {
  date: string;
  slotNumber: number;
  slotLabel: string;
  startTime: string;
  endTime: string;
  weekdayLabel: string;
};

export type SwapApplicant = {
  applicationId: string;
  applicantId: string;
  applicantName: string;
  note: string | null;
};

export type MySwapRequest = {
  id: string;
  kind: SwapKind;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  reason: string;
  status: SwapStatus;
  nominatedName: string | null;
  approvedApplicantName: string | null;
  decisionNote: string | null;
  applicants: SwapApplicant[];
  createdAt: string;
};

export type OpenSwap = {
  id: string;
  kind: SwapKind;
  requesterName: string;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  reason: string;
  /** 自分が応募済みか (取り下げていない) */
  applied: boolean;
};

export type AdminSwapRequest = MySwapRequest & {
  requesterId: string;
  requesterName: string;
};

function labelOf(meta: Awaited<ReturnType<typeof getSlotMeta>>, n: number) {
  const m = meta.get(n);
  return { label: m?.label ?? `${n}限`, start: m?.start ?? "", end: m?.end ?? "" };
}

/** 講師: 交代申請できる「今日以降の自分の確定シフト」(有効な申請があるものは除外) */
export async function getTutorSwappableShifts(
  tutorId: string,
): Promise<SwappableShift[]> {
  const today = jstToday();
  const [meta, shifts, active] = await Promise.all([
    getSlotMeta(),
    db
      .select({ date: weeklyShifts.date, slotNumber: weeklyShifts.slotNumber })
      .from(weeklyShifts)
      .where(
        and(eq(weeklyShifts.tutorId, tutorId), gte(weeklyShifts.date, today)),
      )
      .orderBy(asc(weeklyShifts.date), asc(weeklyShifts.slotNumber)),
    db
      .select({
        date: swapRequests.date,
        slotNumber: swapRequests.slotNumber,
      })
      .from(swapRequests)
      .where(
        and(
          eq(swapRequests.requesterId, tutorId),
          eq(swapRequests.status, "pending"),
        ),
      ),
  ]);
  const blocked = new Set(active.map((a) => `${a.date}|${a.slotNumber}`));
  const seen = new Set<string>();
  const out: SwappableShift[] = [];
  for (const s of shifts) {
    const k = `${s.date}|${s.slotNumber}`;
    if (blocked.has(k) || seen.has(k)) continue;
    seen.add(k);
    const l = labelOf(meta, s.slotNumber);
    out.push({
      date: s.date,
      slotNumber: s.slotNumber,
      slotLabel: l.label,
      startTime: l.start,
      endTime: l.end,
      weekdayLabel: weekdayOf(s.date).label,
    });
  }
  return out;
}

/** 指名先候補: 自分以外の有効な講師 */
export async function getActiveTutorsExcept(
  excludeId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: profiles.id, name: profiles.displayName })
    .from(profiles)
    .where(
      and(
        arrayContains(profiles.roles, ["tutor"]),
        eq(profiles.isActive, true),
        ne(profiles.id, excludeId),
      ),
    )
    .orderBy(asc(profiles.displayName));
  return rows;
}

async function loadApplicants(
  requestIds: string[],
): Promise<Map<string, SwapApplicant[]>> {
  const map = new Map<string, SwapApplicant[]>();
  if (requestIds.length === 0) return map;
  const rows = await db
    .select({
      id: swapApplications.id,
      swapRequestId: swapApplications.swapRequestId,
      applicantId: swapApplications.applicantId,
      applicantName: profiles.displayName,
      note: swapApplications.note,
    })
    .from(swapApplications)
    .innerJoin(profiles, eq(profiles.id, swapApplications.applicantId))
    .where(
      and(
        inArray(swapApplications.swapRequestId, requestIds),
        isNull(swapApplications.withdrawnAt),
      ),
    )
    .orderBy(asc(swapApplications.createdAt));
  for (const r of rows) {
    const list = map.get(r.swapRequestId) ?? [];
    list.push({
      applicationId: r.id,
      applicantId: r.applicantId,
      applicantName: r.applicantName,
      note: r.note,
    });
    map.set(r.swapRequestId, list);
  }
  return map;
}

/** 講師: 自分が出した交代申請の履歴 */
export async function getTutorSwapRequests(
  tutorId: string,
): Promise<MySwapRequest[]> {
  const meta = await getSlotMeta();
  const nominee = alias(profiles, "nominee");
  const approved = alias(profiles, "approved");

  const rows = await db
    .select({
      id: swapRequests.id,
      kind: swapRequests.kind,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
      reason: swapRequests.reason,
      status: swapRequests.status,
      decisionNote: swapRequests.decisionNote,
      nominatedName: nominee.displayName,
      approvedApplicantName: approved.displayName,
      createdAt: swapRequests.createdAt,
    })
    .from(swapRequests)
    .leftJoin(nominee, eq(nominee.id, swapRequests.nominatedTutorId))
    .leftJoin(approved, eq(approved.id, swapRequests.approvedApplicantId))
    .where(eq(swapRequests.requesterId, tutorId))
    .orderBy(desc(swapRequests.createdAt));

  const applicants = await loadApplicants(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as SwapKind,
    date: r.date,
    slotNumber: r.slotNumber,
    slotLabel: labelOf(meta, r.slotNumber).label,
    weekdayLabel: weekdayOf(r.date).label,
    reason: r.reason,
    status: r.status as SwapStatus,
    nominatedName: r.nominatedName,
    approvedApplicantName: r.approvedApplicantName,
    decisionNote: r.decisionNote,
    applicants: applicants.get(r.id) ?? [],
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 講師: 応募できる代講募集 (open, pending, 自分以外, 指名は自分が指名先のみ) */
export async function getOpenSwapsForTutor(
  tutorId: string,
): Promise<OpenSwap[]> {
  const meta = await getSlotMeta();
  const rows = await db
    .select({
      id: swapRequests.id,
      kind: swapRequests.kind,
      requesterName: profiles.displayName,
      nominatedTutorId: swapRequests.nominatedTutorId,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
      reason: swapRequests.reason,
    })
    .from(swapRequests)
    .innerJoin(profiles, eq(profiles.id, swapRequests.requesterId))
    .where(
      and(
        eq(swapRequests.status, "pending"),
        ne(swapRequests.requesterId, tutorId),
      ),
    )
    .orderBy(asc(swapRequests.date), asc(swapRequests.slotNumber));

  // 指名(named)は「自分が指名先」のものだけ見える。open は全員。
  const visible = rows.filter(
    (r) => r.kind === "open" || r.nominatedTutorId === tutorId,
  );

  const myApps =
    visible.length > 0
      ? await db
          .select({ swapRequestId: swapApplications.swapRequestId })
          .from(swapApplications)
          .where(
            and(
              eq(swapApplications.applicantId, tutorId),
              isNull(swapApplications.withdrawnAt),
              inArray(
                swapApplications.swapRequestId,
                visible.map((v) => v.id),
              ),
            ),
          )
      : [];
  const appliedSet = new Set(myApps.map((a) => a.swapRequestId));

  return visible.map((r) => ({
    id: r.id,
    kind: r.kind as SwapKind,
    requesterName: r.requesterName,
    date: r.date,
    slotNumber: r.slotNumber,
    slotLabel: labelOf(meta, r.slotNumber).label,
    weekdayLabel: weekdayOf(r.date).label,
    reason: r.reason,
    applied: appliedSet.has(r.id),
  }));
}

/** 教室長: 未対応の交代申請 + 応募者 */
export async function getPendingSwapRequests(): Promise<AdminSwapRequest[]> {
  const meta = await getSlotMeta();
  const requester = alias(profiles, "requester");
  const nominee = alias(profiles, "nominee");

  const rows = await db
    .select({
      id: swapRequests.id,
      kind: swapRequests.kind,
      requesterId: swapRequests.requesterId,
      requesterName: requester.displayName,
      nominatedName: nominee.displayName,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
      reason: swapRequests.reason,
      status: swapRequests.status,
      decisionNote: swapRequests.decisionNote,
      createdAt: swapRequests.createdAt,
    })
    .from(swapRequests)
    .innerJoin(requester, eq(requester.id, swapRequests.requesterId))
    .leftJoin(nominee, eq(nominee.id, swapRequests.nominatedTutorId))
    .where(eq(swapRequests.status, "pending"))
    .orderBy(asc(swapRequests.date), asc(swapRequests.slotNumber));

  const applicants = await loadApplicants(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as SwapKind,
    requesterId: r.requesterId,
    requesterName: r.requesterName,
    date: r.date,
    slotNumber: r.slotNumber,
    slotLabel: labelOf(meta, r.slotNumber).label,
    weekdayLabel: weekdayOf(r.date).label,
    reason: r.reason,
    status: r.status as SwapStatus,
    nominatedName: r.nominatedName,
    approvedApplicantName: null,
    decisionNote: r.decisionNote,
    applicants: applicants.get(r.id) ?? [],
    createdAt: r.createdAt.toISOString(),
  }));
}
