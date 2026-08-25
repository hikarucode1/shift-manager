import "server-only";
import { and, asc, between, desc, eq, gte, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { absenceRequests, profiles, weeklyShifts } from "@/db/schema";
import { getSlotMeta } from "@/lib/slot-meta";
import { isSlotPast } from "@/lib/slot-time";
import { jstToday, weekdayOf } from "@/lib/week";

export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled";

export type UpcomingShift = {
  date: string;
  slotNumber: number;
  slotLabel: string;
  startTime: string;
  endTime: string;
  weekdayLabel: string;
};

export type AbsenceRequestRow = {
  id: string;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  reason: string;
  status: AbsenceStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type PendingAbsence = AbsenceRequestRow & {
  tutorId: string;
  tutorName: string;
  /**
   * コマが既に終了しているか (#211)。**承認は塞がない** — 後から欠勤を登録する
   * のは正当な実務で、塞ぐと実態に合わせる手段が無くなる (#178/#213 と同じ形)。
   * 「過去のコマの欠勤を承認しようとしている」と気づけるようにするための印。
   */
  isEnded: boolean;
};

/** 決定済み (承認済み / 取り消し済み) の欠勤申請 (#219) */
export type DecidedAbsence = PendingAbsence & {
  /** 決定した教室長。`decided_by` は onDelete: set null なので欠けうる */
  decidedByName: string | null;
  /**
   * 過去日か (#219)。取り消しの可逆性がここで変わる。`createAbsenceRequest` は
   * `date < jstToday()` を弾くため、**過去日の取り消しは一方通行** (講師も教室長も
   * 登録し直せない = #217)。画面で警告するための印で、取り消し自体は塞がない。
   */
  isPastDate: boolean;
};

export type AbsenceHistory = {
  rows: DecidedAbsence[];
  /** limit を超える行がまだ残っているか (1 = 残っている)。**件数ではない** */
  truncated: number;
};

function slotLabelOf(
  meta: Awaited<ReturnType<typeof getSlotMeta>>,
  n: number,
): { label: string; start: string; end: string } {
  const m = meta.get(n);
  return {
    label: m?.label ?? `${n}限`,
    start: m?.start ?? "",
    end: m?.end ?? "",
  };
}

/**
 * 講師が欠勤申請できる「今日以降の自分の確定シフト」一覧。
 * 既に未確定でない (pending/approved) 申請があるコマは除外。
 */
export async function getTutorUpcomingShifts(
  tutorId: string,
): Promise<UpcomingShift[]> {
  const today = jstToday();

  const [meta, shifts, existing] = await Promise.all([
    getSlotMeta(),
    db
      .select({
        date: weeklyShifts.date,
        slotNumber: weeklyShifts.slotNumber,
      })
      .from(weeklyShifts)
      .where(
        and(
          eq(weeklyShifts.tutorId, tutorId),
          gte(weeklyShifts.date, today),
        ),
      )
      .orderBy(asc(weeklyShifts.date), asc(weeklyShifts.slotNumber)),
    db
      .select({
        date: absenceRequests.date,
        slotNumber: absenceRequests.slotNumber,
      })
      .from(absenceRequests)
      .where(
        and(
          eq(absenceRequests.tutorId, tutorId),
          inArray(absenceRequests.status, ["pending", "approved"]),
        ),
      ),
  ]);

  const blocked = new Set(
    existing.map((e) => `${e.date}|${e.slotNumber}`),
  );

  // 同一 (date,slot) は1件に dedupe (再アップロード残骸への防御)
  const seen = new Set<string>();
  const out: UpcomingShift[] = [];
  for (const s of shifts) {
    const k = `${s.date}|${s.slotNumber}`;
    if (blocked.has(k) || seen.has(k)) continue;
    seen.add(k);
    const sl = slotLabelOf(meta, s.slotNumber);
    out.push({
      date: s.date,
      slotNumber: s.slotNumber,
      slotLabel: sl.label,
      startTime: sl.start,
      endTime: sl.end,
      weekdayLabel: weekdayOf(s.date).label,
    });
  }
  return out;
}

export async function getTutorAbsenceRequests(
  tutorId: string,
): Promise<AbsenceRequestRow[]> {
  const meta = await getSlotMeta();
  const rows = await db
    .select()
    .from(absenceRequests)
    .where(eq(absenceRequests.tutorId, tutorId))
    .orderBy(desc(absenceRequests.createdAt));

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    slotNumber: r.slotNumber,
    slotLabel: slotLabelOf(meta, r.slotNumber).label,
    weekdayLabel: weekdayOf(r.date).label,
    reason: r.reason,
    status: r.status as AbsenceStatus,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 教室長: 未対応 (pending) の欠勤申請 */
export async function getPendingAbsenceRequests(): Promise<PendingAbsence[]> {
  const meta = await getSlotMeta();
  const rows = await db
    .select({
      id: absenceRequests.id,
      tutorId: absenceRequests.tutorId,
      tutorName: profiles.displayName,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
      reason: absenceRequests.reason,
      status: absenceRequests.status,
      decisionNote: absenceRequests.decisionNote,
      decidedAt: absenceRequests.decidedAt,
      createdAt: absenceRequests.createdAt,
    })
    .from(absenceRequests)
    .innerJoin(profiles, eq(profiles.id, absenceRequests.tutorId))
    .where(eq(absenceRequests.status, "pending"))
    .orderBy(asc(absenceRequests.date), asc(absenceRequests.slotNumber));

  return rows.map((r) => ({
    id: r.id,
    tutorId: r.tutorId,
    tutorName: r.tutorName,
    date: r.date,
    slotNumber: r.slotNumber,
    slotLabel: slotLabelOf(meta, r.slotNumber).label,
    weekdayLabel: weekdayOf(r.date).label,
    reason: r.reason,
    status: r.status as AbsenceStatus,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    isEnded: isSlotPast(r.date, slotLabelOf(meta, r.slotNumber).end),
  }));
}

/**
 * 決定済み (承認済み / 取り消し済み) の欠勤申請 (#219)。
 *
 * ⚠️ **`cancelled` も返す**。取り消し理由を必須にしておきながら読む画面が無いと
 * write-only になる。`getSwapHistory` と同じ理由・同じ形。
 *
 * ⚠️ 日付では絞らない。**過去のコマこそ是正対象**で、「先週の欠勤を誤承認した」
 * を直せないと週次シフト表の取り消し線が恒久的に残る (#219 の起点)。
 * 代わりに件数で切り、まだ残りがあることを `truncated` で伝える。
 */
export async function getAbsenceHistory(
  status: "approved" | "cancelled",
  limit = 50,
): Promise<AbsenceHistory> {
  const meta = await getSlotMeta();
  const today = jstToday();
  const decider = alias(profiles, "decider");

  const rows = await db
    .select({
      id: absenceRequests.id,
      tutorId: absenceRequests.tutorId,
      tutorName: profiles.displayName,
      decidedByName: decider.displayName,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
      reason: absenceRequests.reason,
      status: absenceRequests.status,
      decisionNote: absenceRequests.decisionNote,
      decidedAt: absenceRequests.decidedAt,
      createdAt: absenceRequests.createdAt,
    })
    .from(absenceRequests)
    .innerJoin(profiles, eq(profiles.id, absenceRequests.tutorId))
    .leftJoin(decider, eq(decider.id, absenceRequests.decidedBy))
    .where(eq(absenceRequests.status, status))
    .orderBy(desc(absenceRequests.date), asc(absenceRequests.slotNumber))
    .limit(limit + 1);

  const truncated = rows.length > limit ? 1 : 0;

  return {
    truncated,
    rows: rows.slice(0, limit).map((r) => ({
      id: r.id,
      tutorId: r.tutorId,
      tutorName: r.tutorName,
      decidedByName: r.decidedByName,
      date: r.date,
      slotNumber: r.slotNumber,
      slotLabel: slotLabelOf(meta, r.slotNumber).label,
      weekdayLabel: weekdayOf(r.date).label,
      reason: r.reason,
      status: r.status as AbsenceStatus,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      isEnded: isSlotPast(r.date, slotLabelOf(meta, r.slotNumber).end),
      isPastDate: r.date < today,
    })),
  };
}

/**
 * 指定講師の「承認済み欠勤」を date|slot の集合で返す。
 * 週次シフト表示に欠勤マークを出すために使用 (weekly_shifts は再アップロードで
 * 入れ替わるため、申請側を真実として join せず別取得)。
 */
export async function getApprovedAbsenceKeys(
  tutorId: string,
  fromDate: string,
  toDate: string,
): Promise<Set<string>> {
  const rows = await db
    .select({
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
    })
    .from(absenceRequests)
    .where(
      and(
        eq(absenceRequests.tutorId, tutorId),
        eq(absenceRequests.status, "approved"),
        between(absenceRequests.date, fromDate, toDate),
      ),
    );
  return new Set(rows.map((r) => `${r.date}|${r.slotNumber}`));
}

/**
 * 全講師の「承認済み欠勤」を `tutorId|date|slot` の集合で返す。
 * 教室長の週次グリッドに欠勤を反映するために使用。
 */
export async function getApprovedAbsenceKeysAll(
  fromDate: string,
  toDate: string,
): Promise<Set<string>> {
  const rows = await db
    .select({
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
    })
    .from(absenceRequests)
    .where(
      and(
        eq(absenceRequests.status, "approved"),
        between(absenceRequests.date, fromDate, toDate),
      ),
    );
  return new Set(
    rows.map((r) => `${r.tutorId}|${r.date}|${r.slotNumber}`),
  );
}
