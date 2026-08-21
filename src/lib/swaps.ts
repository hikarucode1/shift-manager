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
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  profiles,
  swapApplications,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { busySlotKey } from "@/lib/slot-key";
import { getSlotMeta } from "@/lib/slot-meta";
import { isSlotPast } from "@/lib/slot-time";
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
  /**
   * コマが既に終了しているか (#178)。**操作は塞がない** — 同日中の応募・承認は
   * 「実際に誰が入ったか」を記録する正当な操作なので残す。注意表示のための印。
   */
  isEnded: boolean;
  /** 過去日で、応募がサーバー側で弾かれるか (#165)。ボタンを落とす印 */
  isPastDate: boolean;
};

export type AdminSwapRequest = MySwapRequest & {
  requesterId: string;
  /** コマが既に終了しているか (#178)。注意表示のみ。承認は同日中なら通る */
  isEnded: boolean;
  /** 過去日で、承認がサーバー側で弾かれるか (#165)。承認ボタンを落とす印 */
  isPastDate: boolean;
  requesterName: string;
};

function labelOf(meta: Awaited<ReturnType<typeof getSlotMeta>>, n: number) {
  const m = meta.get(n);
  return { label: m?.label ?? `${n}限`, start: m?.start ?? "", end: m?.end ?? "" };
}

/**
 * コマ定義を引いて終了済みか判定する (#178)。
 *
 * ⚠️ 交代・代講のガードは元々**日付粒度** (`date < jstToday()`) で、
 * 「今朝終わったコマを午後に交代」が素通りしていた。承認は weekly_shifts の
 * 担当を付け替えるので、実施済みコマが事後に書き換わると勤怠・給与の履歴が崩れる。
 * 申請 / 応募 / 承認の 3 経路すべてでこれを通すこと。
 */
export async function hasSlotEnded(
  date: string,
  slotNumber: number,
): Promise<boolean> {
  const meta = await getSlotMeta();
  return isSlotPast(date, meta.get(slotNumber)?.end ?? "");
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
    // #178: gte(date, today) だと**今日の終了済みコマ**まで候補に残る。
    // 選んで送信して初めて弾かれるので、ここで落とす。
    if (isSlotPast(s.date, l.end)) continue;
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

/** db 本体・transaction のどちらでも受けられる executor 型 */
type Executor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 指定講師がその (date, slotNumber) に既に出勤予定か。
 * 「同コマ出勤 = 代講不可」の clash 述語の単一ソース。応募 (applyToSwap)・
 * 指名の作成時検証 (createSwapRequest)・承認時の applicant 検証
 * (admin/requests/swap-actions) はいずれもこの 1 箇所を通す。transaction 内から
 * 呼ぶ場合は executor に tx を渡す (省略時は db 本体)。
 */
export async function isTutorBusyAt(
  date: string,
  slotNumber: number,
  tutorId: string,
  executor: Executor = db,
): Promise<boolean> {
  const rows = await executor
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, tutorId),
        eq(weeklyShifts.date, date),
        eq(weeklyShifts.slotNumber, slotNumber),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 行 → コマ別の出勤講師 id。DB を触らない純関数なのでテストできる。
 */
export function groupBusyBySlot(
  rows: { date: string; slotNumber: number; tutorId: string }[],
): Record<string, string[]> {
  const busy: Record<string, string[]> = {};
  for (const row of rows) {
    const key = busySlotKey(row.date, row.slotNumber);
    (busy[key] ??= []).push(row.tutorId);
  }
  return busy;
}

/**
 * 指定コマ群について「そのコマに出勤予定の講師 id」を引く (#181)。
 *
 * 指名セレクトで同コマ出勤中の講師を disable するための先出し情報。
 * ⚠️ **これは整合性の境界ではない**。指名の可否は createSwapRequest 側の
 * `isTutorBusyAt` が担保する (UI を通らない経路があるため)。ここはあくまで
 * 「選んで送信して初めてエラーになる」体験を減らすためのもの。
 *
 * ⚠️ 条件を `date IN (...) AND slot IN (...)` にしないこと。日付とコマの
 * 直積になり、**別のコマの出勤を拾って余計な講師を disable する**。
 * ペアごとに OR で並べて厳密に指定する。
 */
export async function getBusyTutorIdsBySlot(
  slots: { date: string; slotNumber: number }[],
): Promise<Record<string, string[]>> {
  // ⚠️ この早期 return は load-bearing。drizzle の `or()` は条件 0 件で
  // undefined を返し、`.where(undefined)` は WHERE 句ごと落ちるので、
  // 消すと weekly_shifts 全件を引いて**全講師が disable される**。
  // 「交代に出せるコマが 0 件」は新人講師や週明けに普通に起きる状態。
  if (slots.length === 0) return {};

  const rows = await db
    .select({
      date: weeklyShifts.date,
      slotNumber: weeklyShifts.slotNumber,
      tutorId: weeklyShifts.tutorId,
    })
    .from(weeklyShifts)
    .where(
      or(
        ...slots.map((s) =>
          and(
            eq(weeklyShifts.date, s.date),
            eq(weeklyShifts.slotNumber, s.slotNumber),
          ),
        ),
      ),
    );

  return groupBusyBySlot(rows);
}

/**
 * その (date, slotNumber) の代講に「応募資格のある」現役講師 id の一覧。
 * = 現役の tutor (自分を除く) から、同じコマに既に出勤予定の講師 (= {@link isTutorBusyAt}
 * が true = applyToSwap の clash で弾かれる) を除いたもの。単発判定は isTutorBusyAt、
 * 一括の宛先解決はこちら、という一括版。open 募集の通知宛先の算出に使う
 * (named 指名先は createSwapRequest が作成時に検証するのでここは通らない)。
 * 通知宛先の解決にしか使わないため id のみ・ソートなし。
 */
export async function getEligibleApplicantIds(
  date: string,
  slotNumber: number,
  excludeId: string,
): Promise<string[]> {
  const [candidates, assigned] = await Promise.all([
    db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          arrayContains(profiles.roles, ["tutor"]),
          eq(profiles.isActive, true),
          ne(profiles.id, excludeId),
        ),
      ),
    db
      .select({ tutorId: weeklyShifts.tutorId })
      .from(weeklyShifts)
      .where(
        and(
          eq(weeklyShifts.date, date),
          eq(weeklyShifts.slotNumber, slotNumber),
        ),
      ),
  ]);
  const busy = new Set(assigned.map((r) => r.tutorId));
  return candidates.map((c) => c.id).filter((id) => !busy.has(id));
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
  const today = jstToday();
  const meta = await getSlotMeta();
  // #165: 過去日 pending の実害 (実施済みコマの再割当) は承認側 (decideSwapRequest)
  // で塞ぐ。一覧から過去日を除外すると、応募済みの過去 pending が withdraw 導線ごと
  // 消えて取り下げ不能になるため、ここでは日付で絞らない (応募/承認は各アクションで
  // ガード)。
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
    isEnded: isSlotPast(r.date, labelOf(meta, r.slotNumber).end),
    isPastDate: r.date < today,
  }));
}

/** 教室長: 未対応の交代申請 + 応募者 */
export async function getPendingSwapRequests(): Promise<AdminSwapRequest[]> {
  const today = jstToday();
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
    isEnded: isSlotPast(r.date, labelOf(meta, r.slotNumber).end),
    isPastDate: r.date < today,
    approvedApplicantName: null,
    decisionNote: r.decisionNote,
    applicants: applicants.get(r.id) ?? [],
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * 承認済みの交代・代講 (#213)。取り消しの対象を教室長が見るための一覧。
 *
 * ⚠️ これが無いと**承認済みを取り消す画面が存在しない**。`approved` は終端状態で、
 * 唯一の是正手段が「CSV を上げ直して巻き戻す」という副作用の大きいバグ頼み
 * だった (#210)。
 *
 * 直近のものから見せる。過去のコマこそ「実際は代講が流れた」の是正対象なので
 * 日付では絞らない。
 */
export type SwapHistory = {
  rows: AdminSwapRequest[];
  /** limit で切り捨てた件数 (0 なら全部出ている) */
  truncated: number;
};

/**
 * 承認済み / 取り消し済みの交代・代講 (#213)。
 *
 * ⚠️ **`cancelled` も返す**。取り消し理由を必須にしておきながら admin から
 * 読む画面が無いと、書かせた本人が二度と読めない (write-only) 状態になる。
 * 給与でモメたときに「一度代講が入って取り消された」を確認する唯一の手段。
 *
 * ⚠️ 日付では絞らない。過去のコマこそ「実際は代講が流れた」の是正対象。
 * 代わりに件数で切り、**切り捨てた件数を返す** (黙って落とすと、取り消したい
 * 古い代講が一覧から消えたことに気づけない)。
 */
export async function getSwapHistory(
  status: "approved" | "cancelled",
  limit = 50,
): Promise<SwapHistory> {
  const today = jstToday();
  const meta = await getSlotMeta();
  const requester = alias(profiles, "requester");
  const nominee = alias(profiles, "nominee");
  const approved = alias(profiles, "approvedApplicant");

  const rows = await db
    .select({
      id: swapRequests.id,
      kind: swapRequests.kind,
      requesterId: swapRequests.requesterId,
      requesterName: requester.displayName,
      nominatedName: nominee.displayName,
      approvedApplicantName: approved.displayName,
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
    .leftJoin(approved, eq(approved.id, swapRequests.approvedApplicantId))
    .where(eq(swapRequests.status, status))
    .orderBy(desc(swapRequests.date), asc(swapRequests.slotNumber))
    .limit(limit + 1);

  const truncated = rows.length > limit ? 1 : 0;
  const visible = rows.slice(0, limit);

  return {
    truncated,
    rows: visible.map((r) => ({
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
      isEnded: isSlotPast(r.date, labelOf(meta, r.slotNumber).end),
      isPastDate: r.date < today,
      approvedApplicantName: r.approvedApplicantName,
      decisionNote: r.decisionNote,
      applicants: [],
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
