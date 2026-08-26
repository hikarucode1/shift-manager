import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { absenceRequests, profiles, swapRequests } from "@/db/schema";
import { ABSENCE_AUTO_EXPIRED_NOTE } from "@/lib/absence-expiry";
import { getSlotMeta } from "@/lib/slot-meta";
import {
  mergeLogEntries,
  toAbsenceLogEntry,
  toSwapLogEntry,
  type LogStatus,
  type RequestLogEntry,
} from "@/lib/request-log";
import { weekdayOf } from "@/lib/week";

/** 台帳に出す状態。`pending` は未対応タブの担当なので含めない */
export const LOG_STATES = ["approved", "cancelled", "rejected"] as const;
export type LogStateFilter = (typeof LOG_STATES)[number] | "all";
export type LogTypeFilter = "all" | "absence" | "swap";
/** 既定は直近 1 ヶ月。飽和 (#224) は件数上限ではなく期間で抑える */
export type LogPeriodFilter = "1m" | "3m" | "all";

export type RequestLog = {
  rows: RequestLogEntry[];
  /** limit を超える行がまだ残っているか。**件数ではない** */
  truncated: boolean;
};

const DEFAULT_LIMIT = 50;

function sinceIso(period: LogPeriodFilter, now: Date): Date | null {
  if (period === "all") return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() - (period === "1m" ? 1 : 3));
  return d;
}

/**
 * 承認済み・取り消し済み・却下の申請を、種別をまたいだ 1 本の時系列で返す (#224)。
 *
 * ⚠️ **並びは決定順** (`coalesce(decided_at, updated_at)`)。対象コマの日付順では
 * ない — #215 で過去のコマを記録できるようになったため、date 順だと今日の操作が
 * 一覧の底に沈み、取り消せなくなる (#233)。
 *
 * ⚠️ **第 2 キーは `id`**。`mergeLogEntries` が同時刻を id で並べるので、SQL 側が
 * 別のキー (以前は `slot_number`) だと limit 境界で取りこぼす。
 *
 * ⚠️ 各テーブルから `limit + 1` 件取って `mergeLogEntries` に渡す。理由はそちらの
 * docstring を参照。
 */
export async function getRequestLog(opts: {
  period: LogPeriodFilter;
  type: LogTypeFilter;
  state: LogStateFilter;
  limit?: number;
  now?: Date;
}): Promise<RequestLog> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const states: LogStatus[] =
    opts.state === "all" ? [...LOG_STATES] : [opts.state];
  const since = sinceIso(opts.period, opts.now ?? new Date());
  const meta = await getSlotMeta();
  const label = (n: number) => meta.get(n)?.label ?? `${n}限`;

  const absenceOccurred = sql`coalesce(${absenceRequests.decidedAt}, ${absenceRequests.updatedAt})`;
  const swapOccurred = sql`coalesce(${swapRequests.decidedAt}, ${swapRequests.updatedAt})`;

  const absenceDecider = alias(profiles, "absenceDecider");
  const swapDecider = alias(profiles, "swapDecider");
  const requester = alias(profiles, "requester");
  const applicant = alias(profiles, "applicant");

  const wantAbsence = opts.type !== "swap";
  const wantSwap = opts.type !== "absence";

  const [absences, swaps] = await Promise.all([
    wantAbsence
      ? db
          .select({
            id: absenceRequests.id,
            status: absenceRequests.status,
            tutorId: absenceRequests.tutorId,
            tutorName: profiles.displayName,
            createdBy: absenceRequests.createdBy,
            actorName: absenceDecider.displayName,
            date: absenceRequests.date,
            slotNumber: absenceRequests.slotNumber,
            reason: absenceRequests.reason,
            note: absenceRequests.decisionNote,
            decidedAt: absenceRequests.decidedAt,
            updatedAt: absenceRequests.updatedAt,
          })
          .from(absenceRequests)
          .innerJoin(profiles, eq(profiles.id, absenceRequests.tutorId))
          .leftJoin(
            absenceDecider,
            eq(absenceDecider.id, absenceRequests.decidedBy),
          )
          .where(
            and(
              inArray(absenceRequests.status, states),
              since ? gte(absenceOccurred, since) : undefined,
            ),
          )
          .orderBy(desc(absenceOccurred), asc(absenceRequests.id))
          .limit(limit + 1)
      : Promise.resolve([]),
    wantSwap
      ? db
          .select({
            id: swapRequests.id,
            status: swapRequests.status,
            kind: swapRequests.kind,
            requesterId: swapRequests.requesterId,
            requesterName: requester.displayName,
            approvedApplicantName: applicant.displayName,
            createdBy: swapRequests.createdBy,
            actorName: swapDecider.displayName,
            date: swapRequests.date,
            slotNumber: swapRequests.slotNumber,
            reason: swapRequests.reason,
            note: swapRequests.decisionNote,
            decidedAt: swapRequests.decidedAt,
            updatedAt: swapRequests.updatedAt,
          })
          .from(swapRequests)
          .innerJoin(requester, eq(requester.id, swapRequests.requesterId))
          .leftJoin(
            applicant,
            eq(applicant.id, swapRequests.approvedApplicantId),
          )
          .leftJoin(swapDecider, eq(swapDecider.id, swapRequests.decidedBy))
          .where(
            and(
              inArray(swapRequests.status, states),
              since ? gte(swapOccurred, since) : undefined,
            ),
          )
          .orderBy(desc(swapOccurred), asc(swapRequests.id))
          .limit(limit + 1)
      : Promise.resolve([]),
  ]);

  const absenceEntries = absences.map((r) =>
    toAbsenceLogEntry({
      id: r.id,
      status: r.status as LogStatus,
      date: r.date,
      slotNumber: r.slotNumber,
      slotLabel: label(r.slotNumber),
      weekdayLabel: weekdayOf(r.date).label,
      reason: r.reason,
      note: r.note,
      actorName: r.actorName,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      tutorName: r.tutorName,
      // ⚠️ null ガードを外さないこと。0034 は backfill 無しなので、それ以前の
      // 行は created_by = null (= 講師本人が作った行)
      isProxy: r.createdBy !== null && r.createdBy !== r.tutorId,
      autoExpired: r.note === ABSENCE_AUTO_EXPIRED_NOTE,
    }),
  );

  const swapEntries = swaps.map((r) =>
    toSwapLogEntry({
      id: r.id,
      status: r.status as LogStatus,
      date: r.date,
      slotNumber: r.slotNumber,
      slotLabel: label(r.slotNumber),
      weekdayLabel: weekdayOf(r.date).label,
      reason: r.reason,
      note: r.note,
      actorName: r.actorName,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      requesterName: r.requesterName,
      isProxy: r.createdBy !== null && r.createdBy !== r.requesterId,
      approvedApplicantName: r.approvedApplicantName,
      isRecorded: r.kind === "recorded",
    }),
  );

  return mergeLogEntries([absenceEntries, swapEntries], limit);
}
