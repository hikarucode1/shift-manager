import "server-only";
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db/client";
import { absenceRequests, profiles, weeklyShifts } from "@/db/schema";
import { ABSENCE_AUTO_EXPIRED_NOTE } from "@/lib/absence-expiry";
import { ABSENCE_CLOSED_UNASSIGNED_NOTE } from "@/lib/pending-absence-actions";
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
  /**
   * 交代成立による自動失効か (#250)。**`decisionNote` を「教室長より」として
   * 出さないため**に要る — 失効は誰の判断でもなく、#225 で admin 側は
   * `decided_by` を null にして誤帰属を消したのに、講師側だけ残っていた。
   * 判定は admin 側 (`request-log.ts`) と同じく `decided_by` との AND。
   */
  autoExpired: boolean;
  /**
   * 教室長が「不要として閉じる」(#289) で閉じたか。自動失効と同じく、
   * `decisionNote` を赤字の「教室長より」で出さないために要る — 担当でなく
   * なったことの説明で、叱っているのではない。判定は note と `decided_by`
   * (閉じた教室長が入る) の AND
   */
  closedUnassigned: boolean;
  decidedAt: string | null;
  createdAt: string;
  /**
   * 教室長の代理登録か (#217)。`created_by !== tutor_id` で判定する。
   * `created_by` が null の行は false。null は「#217 以前に作られた」か
   * 「登録者の profile が削除された (FK は set null)」のどちらかで、
   * **本人申告であることの証明にはならない**。
   */
  isProxy: boolean;
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
  /**
   * 申請した講師が今もそのコマの担当か (#289)。カードの出し分け
   * (`pendingAbsenceActions`) に使う。条件は `absenceTutorAssigned`
   */
  tutorAssigned: boolean;
};

/**
 * 欠勤申請の講師が、今もその (日, コマ) の担当か (#289)。`absence_requests` の
 * 行に対して評価する SQL の断片。
 *
 * ⚠️ **一覧 (`getPendingAbsenceRequests`)・不要として閉じる
 * (`closeUnassignedAbsence`)・承認 / 却下 (`decideAbsenceRequest`) の 3 か所が
 * これを使う。** カードとサーバの判定がずれないよう、書き写さないこと。
 * 条件は `isTutorBusyAt` (swaps.ts) と同じ (`weekly_shifts` に (講師, 日, コマ)
 * の行があるか)。join ではなく exists にするのは、`weekly_shifts` が
 * (upload, 講師, 日, コマ) で一意なので行が重複しうるため
 */
export function absenceTutorAssigned(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${weeklyShifts}
    where ${weeklyShifts.tutorId} = ${absenceRequests.tutorId}
      and ${weeklyShifts.date} = ${absenceRequests.date}
      and ${weeklyShifts.slotNumber} = ${absenceRequests.slotNumber}
  )`;
}

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
    isProxy: r.createdBy !== null && r.createdBy !== r.tutorId,
    autoExpired:
      r.decisionNote === ABSENCE_AUTO_EXPIRED_NOTE && r.decidedBy === null,
    closedUnassigned:
      r.decisionNote === ABSENCE_CLOSED_UNASSIGNED_NOTE && r.decidedBy !== null,
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
      decidedBy: absenceRequests.decidedBy,
      decidedAt: absenceRequests.decidedAt,
      createdBy: absenceRequests.createdBy,
      createdAt: absenceRequests.createdAt,
      tutorAssigned: absenceTutorAssigned(),
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
    // 代理登録は approved で入るので pending には出ないが、判定は 1 箇所に
    // 寄せず各取得関数で素直に計算する (将来 pending 経由を足しても壊れない)
    isProxy: r.createdBy !== null && r.createdBy !== r.tutorId,
    // pending が自動失効していることは無いが、判定は各取得関数で素直に計算する
    autoExpired:
      r.decisionNote === ABSENCE_AUTO_EXPIRED_NOTE && r.decidedBy === null,
    closedUnassigned:
      r.decisionNote === ABSENCE_CLOSED_UNASSIGNED_NOTE && r.decidedBy !== null,
    isEnded: isSlotPast(r.date, slotLabelOf(meta, r.slotNumber).end),
    tutorAssigned: r.tutorAssigned,
  }));
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
