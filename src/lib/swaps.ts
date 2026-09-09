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
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  profiles,
  swapApplications,
  swapKindEnum,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import {
  toApplicationRow,
  type MyApplication,
} from "@/lib/application-outcome";
import { busySlotKey } from "@/lib/slot-key";
import { getSlotMeta } from "@/lib/slot-meta";
import { isSlotPast } from "@/lib/slot-time";
import { jstToday, weekdayOf } from "@/lib/week";

/**
 * ⚠️ enum から導出する。手書きで並べていたため #215 で `recorded` を足したとき
 * 二重管理になっていた (tsc が比較の不整合として検出した)。
 */
export type SwapKind = (typeof swapKindEnum.enumValues)[number];
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
  /**
   * 教室長の代理募集か (#227)。`created_by !== requester_id` で判定する。
   * `requester_id` は「休む講師」なので、これが無いと本人が出した申請と
   * 区別できない。null は #227 以前か、作成者の profile 削除済み。
   */
  isProxy: boolean;
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
  /**
   * 決定 (承認 / 却下 / 取り消し / 記録) の時刻 (#233)。履歴タブはこれで並べる
   * ので、根拠を画面にも出す。決定前は null
   */
  decidedAt: string | null;
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
      createdBy: swapRequests.createdBy,
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
    isProxy: r.createdBy !== null && r.createdBy !== tutorId,
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
      createdBy: swapRequests.createdBy,
      decidedAt: swapRequests.decidedAt,
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
    isProxy: r.createdBy !== null && r.createdBy !== r.requesterId,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * その募集に応募していて、まだ取り下げていない講師の id (#238 / #245)。
 *
 * ⚠️ **募集の status を更新した「後」に呼ぶこと。** 先に取ると、SELECT と
 * UPDATE の間に入った応募を取りこぼして通知が届かない。後なら `applyToSwap` の
 * `FOR UPDATE` で両方向とも安全 (応募が先 → こちらの UPDATE がロック待ち /
 * こちらが先 → applyToSwap が status 再検証で弾かれ応募が生まれない)。
 * 決定は `swap_applications` を書き換えない (`withdrawnAt` を立てるのは講師の
 * 自己取り下げだけ) ので、後から引いても実質同じ結果になる。厳密には、
 * コミット後に落選者が自分で取り下げるとその人は対象から外れるが、本人が
 * 降りたということなので無害。
 */
export async function getActiveApplicantIds(swapRequestId: string): Promise<string[]> {
  const rows = await db
    .select({ applicantId: swapApplications.applicantId })
    .from(swapApplications)
    .where(
      and(
        eq(swapApplications.swapRequestId, swapRequestId),
        isNull(swapApplications.withdrawnAt),
      ),
    );
  return rows.map((r) => r.applicantId);
}

export type { MyApplication };

/**
 * 自分が関わった代講の**結果**一覧 (#245 / #247)。
 *
 * ⚠️ **`swap_requests` 起点**。自分の応募 (`swap_applications`) を left join し、
 * 「応募した」か「代講者として記録された」のどちらかで拾う。応募起点にすると
 * **教室長が記録した代講 (#215) が構造的に入らない** — 記録は募集も応募も
 * 経由しないので子行が 1 件も無く、`requester_id` は休む講師なので
 * `getTutorSwapRequests` にも出ない。#247 以前はどのクエリにも出なかった。
 *
 * ⚠️ 別の一覧に分けない。分けると「応募して選ばれた」行が
 * `swap_applications` と `approved_applicant_id` の両方に該当して重複する。
 * 応募か記録かは outcome の違いであって、一覧を分ける理由にはならない。
 *
 * ⚠️ `pending` は除く (応募中は募集一覧に「応募済み」として出ている)。
 * 自分で取り下げた応募も除く (結果を知る必要が無い)。ただし**代講者として
 * 記録されていれば、取り下げ済みでも出す** — 実際に入ったコマなので。
 *
 * ⚠️ **件数で切らない。** 兄弟の講師向け一覧 (`getTutorSwapRequests` /
 * `getTutorAbsenceRequests`) はどちらも無制限で、件数は本人の関与回数で
 * 自然に抑えられる。無警告の打ち切りは「黙って切り捨てない」(#224) に反する。
 */
export async function getTutorApplications(
  tutorId: string,
): Promise<MyApplication[]> {
  const meta = await getSlotMeta();
  const requester = alias(profiles, "applicationRequester");
  const myApplication = alias(swapApplications, "myApplication");

  const rows = await db
    .select({
      id: swapRequests.id,
      applicationId: myApplication.id,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
      requesterName: requester.displayName,
      reason: swapRequests.reason,
      status: swapRequests.status,
      approvedApplicantId: swapRequests.approvedApplicantId,
      note: swapRequests.decisionNote,
      decidedAt: swapRequests.decidedAt,
      updatedAt: swapRequests.updatedAt,
    })
    .from(swapRequests)
    .innerJoin(requester, eq(requester.id, swapRequests.requesterId))
    .leftJoin(
      myApplication,
      and(
        eq(myApplication.swapRequestId, swapRequests.id),
        eq(myApplication.applicantId, tutorId),
        isNull(myApplication.withdrawnAt),
      ),
    )
    .where(
      and(
        inArray(swapRequests.status, ["approved", "rejected", "cancelled"]),
        or(
          isNotNull(myApplication.id),
          eq(swapRequests.approvedApplicantId, tutorId),
        ),
      ),
    )
    .orderBy(
      desc(sql`coalesce(${swapRequests.decidedAt}, ${swapRequests.updatedAt})`),
      asc(swapRequests.id),
    );

  return rows.flatMap((r) => {
    const row = toApplicationRow(
      {
        id: r.id,
        status: r.status,
        date: r.date,
        slotNumber: r.slotNumber,
        slotLabel: labelOf(meta, r.slotNumber).label,
        weekdayLabel: weekdayOf(r.date).label,
        requesterName: r.requesterName,
        reason: r.reason,
        applicationId: r.applicationId,
        approvedApplicantId: r.approvedApplicantId,
        note: r.note,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        updatedAt: r.updatedAt.toISOString(),
      },
      tutorId,
    );
    return row ? [row] : [];
  });
}
