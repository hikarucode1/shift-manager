import "server-only";
import {
  and,
  asc,
  between,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  absenceRequests,
  profiles,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import {
  designationState,
  type DesignationState,
  type LinkedSwap,
} from "@/lib/designated-substitution";
import { absenceCloseFlags } from "@/lib/absence-close-kind";
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
  /** 研修のコマ (#335)。2026/11/21 本人: 欠勤だけで、代講の対象にしない */
  isTraining: boolean;
  /** 体験授業の生徒がいるコマ (#335)。印を出すだけ */
  isTrial: boolean;
  /**
   * 未定のコマ (生徒も研修も体験も無い、室長レビュー要望9)。研修と同じく
   * 欠勤だけで、代講の対象にしない
   */
  isUndecided: boolean;
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
   * 判定は `close_kind` (#292、`absenceCloseFlags`)。
   */
  autoExpired: boolean;
  /**
   * 教室長が「不要として閉じる」(#289) で閉じたか。自動失効と同じく、
   * `decisionNote` を赤字の「教室長より」で出さないために要る — 担当でなく
   * なったことの説明で、叱っているのではない。判定は `close_kind` (#292)
   */
  closedUnassigned: boolean;
  /**
   * 代講の取り消しで担当でなくなり、自動失効したか (#291)。自動失効と同じく
   * 誰の判断でもないので、`decisionNote` を「教室長より」で出さない
   */
  expiredUnassigned: boolean;
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

/** 講師の「欠勤等」の 1 行。#331 の代講依頼の状態を足したもの */
export type TutorAbsenceRow = AbsenceRequestRow & {
  /** 教室長が指定した代講の相手への依頼の状態 (#331) */
  designation: DesignationState;
  /** 指定された相手の名前 (指定が無ければ null) */
  designatedName: string | null;
  /**
   * 要望2: 状態に合う相手 (さん付き、複数なら「・」でつなぐ)。返事待ちなら
   * 返事待ちの人、引き受けたら引き受けた人、断られたら断った人
   */
  designationNames: string;
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
  /** 研修のコマ。2026/11/21 本人: 承認のときに代講 (指名・募集) を出さない */
  isTraining: boolean;
  /** 体験授業の生徒がいるコマ (印だけ) */
  isTrial: boolean;
  /** 未定のコマ (生徒も研修も体験も無い)。研修と同じく代講を出さない */
  isUndecided: boolean;
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

/**
 * 欠勤申請のコマが研修か / 体験授業の生徒がいるか (2026/11/21 本人: 一覧に
 * 印を出し、研修は代講を出さない)。`absenceTutorAssigned` と同じく、欠勤の
 * 講師がそのコマに持っている `weekly_shifts` の行を見る
 */
// ⚠️ select の列に置く相関サブクエリでは、drizzle が `${table.col}` を
// **テーブル名なし** ("id" など) で出す。外側の行を指したつもりが内側の
// テーブルの列に解決され、条件が常に真/偽になる。なのでここは名前を直書きする
export function absenceIsTraining(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "weekly_shifts" ws
    where ws."tutor_id" = "absence_requests"."tutor_id"
      and ws."date" = "absence_requests"."date"
      and ws."slot_number" = "absence_requests"."slot_number"
      and ws."is_training"
  )`;
}

export function absenceHasTrial(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "weekly_shifts" ws
    join "shift_assignments" sa on sa."weekly_shift_id" = ws."id"
    where ws."tutor_id" = "absence_requests"."tutor_id"
      and ws."date" = "absence_requests"."date"
      and ws."slot_number" = "absence_requests"."slot_number"
      and sa."is_trial"
  )`;
}

/** 未定のコマか (研修でなく、生徒が 1 人もいない)。室長レビュー要望9 */
export function absenceIsUndecided(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "weekly_shifts" ws
    where ws."tutor_id" = "absence_requests"."tutor_id"
      and ws."date" = "absence_requests"."date"
      and ws."slot_number" = "absence_requests"."slot_number"
      and not ws."is_training"
      and not exists (
        select 1 from "shift_assignments" sa
        where sa."weekly_shift_id" = ws."id"
      )
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
 * 講師が欠勤申請できる「明日以降の自分の確定シフト」一覧。
 * 既に未確定でない (pending/approved) 申請があるコマは除外。
 *
 * 2026/11/21 本人: 当日 (日付が今日) の欠勤はアプリでは受け付けず、教室に
 * 電話してもらう (`createAbsenceRequest` も同じ規則で弾く)。電話で受けた
 * 欠勤は教室長が代理登録 (`createAbsenceOnBehalf`) で記録する
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
        isTraining: weeklyShifts.isTraining,
        // ⚠️ 外側の列はテーブル名を直書き (absenceIsTraining の注記)
        isTrial: sql<boolean>`exists (
          select 1 from "shift_assignments" sa
          where sa."weekly_shift_id" = "weekly_shifts"."id"
            and sa."is_trial"
        )`,
        hasStudent: sql<boolean>`exists (
          select 1 from "shift_assignments" sa
          where sa."weekly_shift_id" = "weekly_shifts"."id"
        )`,
      })
      .from(weeklyShifts)
      .where(
        and(
          eq(weeklyShifts.tutorId, tutorId),
          gt(weeklyShifts.date, today),
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
      isTraining: s.isTraining,
      isTrial: s.isTrial,
      isUndecided: !s.isTraining && !s.hasStudent,
    });
  }
  return out;
}

export async function getTutorAbsenceRequests(
  tutorId: string,
): Promise<TutorAbsenceRow[]> {
  const meta = await getSlotMeta();
  const rows = await db
    .select()
    .from(absenceRequests)
    .where(eq(absenceRequests.tutorId, tutorId))
    .orderBy(desc(absenceRequests.createdAt));

  // #331: 指定された相手の名前と、欠勤に紐づく依頼
  const [linked] = await Promise.all([
    rows.length > 0
      ? db
          .select({
            absenceRequestId: swapRequests.absenceRequestId,
            status: swapRequests.status,
            nominatedTutorId: swapRequests.nominatedTutorId,
            closeKind: swapRequests.closeKind,
          })
          .from(swapRequests)
          .where(
            inArray(
              swapRequests.absenceRequestId,
              rows.map((r) => r.id),
            ),
          )
      : Promise.resolve([]),
  ]);
  const designatedIds = [
    ...new Set(
      [
        ...rows.map((r) => r.designatedSubstituteId),
        ...linked.map((l) => l.nominatedTutorId),
      ].filter((v): v is string => !!v),
    ),
  ];
  const [nameRows] = await Promise.all([
    designatedIds.length > 0
      ? db
          .select({ id: profiles.id, name: profiles.displayName })
          .from(profiles)
          .where(inArray(profiles.id, designatedIds))
      : Promise.resolve([]),
  ]);
  const nameById = new Map(nameRows.map((n) => [n.id, n.name]));

  return rows.map((r) => {
    const mine = linked
      .filter((l) => l.absenceRequestId === r.id)
      .map((l) => ({
        status: l.status as LinkedSwap["status"],
        nominatedTutorId: l.nominatedTutorId,
        closeKind: l.closeKind,
      }));
    const designation = designationState({
      absenceStatus: r.status as AbsenceStatus,
      designatedId: r.designatedSubstituteId,
      linkedSwaps: mine,
      isEnded: isSlotPast(r.date, slotLabelOf(meta, r.slotNumber).end),
    });
    const namesWhere = (pred: (l: LinkedSwap) => boolean) =>
      [
        ...new Set(
          mine
            .filter(pred)
            .map((l) => l.nominatedTutorId)
            .filter((v): v is string => v !== null),
        ),
      ]
        .map((id) => `${nameById.get(id) ?? "不明"}さん`)
        .join("・");
    return {
      designatedName: r.designatedSubstituteId
        ? (nameById.get(r.designatedSubstituteId) ?? "不明")
        : null,
      designationNames:
        designation.kind === "requested"
          ? namesWhere((l) => l.status === "pending")
          : designation.kind === "accepted"
            ? namesWhere((l) => l.status === "approved")
            : designation.kind === "declined"
              ? namesWhere((l) => l.closeKind === "nominee_declined")
              : "",
      designation,
      id: r.id,
      isProxy: r.createdBy !== null && r.createdBy !== r.tutorId,
      ...absenceCloseFlags(r.closeKind),
      date: r.date,
      slotNumber: r.slotNumber,
      slotLabel: slotLabelOf(meta, r.slotNumber).label,
      weekdayLabel: weekdayOf(r.date).label,
      reason: r.reason,
      status: r.status as AbsenceStatus,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
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
      closeKind: absenceRequests.closeKind,
      createdBy: absenceRequests.createdBy,
      createdAt: absenceRequests.createdAt,
      tutorAssigned: absenceTutorAssigned(),
      isTraining: absenceIsTraining(),
      isTrial: absenceHasTrial(),
      isUndecided: absenceIsUndecided(),
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
    // pending が閉じていることは無いが、型を共有しているので同じく計算する
    ...absenceCloseFlags(r.closeKind),
    isEnded: isSlotPast(r.date, slotLabelOf(meta, r.slotNumber).end),
    tutorAssigned: r.tutorAssigned,
    isTraining: r.isTraining,
    isTrial: r.isTrial,
    isUndecided: r.isUndecided,
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

/**
 * #331: 代講の相手を指名したが、まだ代講が決まっていない欠勤。
 * 要望2で、断られたもの (declined) に加えて返事待ち (requested) も出す
 * (返事が遅いときに、ほかの講師にも指名できるように)
 */
export type UnfilledAbsence = {
  id: string;
  tutorId: string;
  tutorName: string;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  reason: string;
  /** requested: 誰かの返事待ち / declined: 指名した全員に断られた */
  state: "requested" | "declined";
  /** 返事待ちの相手の名前 */
  waitingNames: string[];
  /** 断った相手の名前 */
  declinedNames: string[];
  /** 返事待ちの相手 (足す候補から外す) */
  waitingIds: string[];
  /** この欠勤の代講を断った講師全員 (足す候補から外す) */
  declinedIds: string[];
};

/**
 * 教室長が代講の相手を指定した承認済みの欠勤のうち、まだ代講が決まって
 * いないもの (#331)。相手に断られたもの (次の相手を指名するか、代理募集に
 * 出す) と、要望2で返事待ちのもの (ほかの講師にも指名する) を出す。
 *
 * 出さないもの:
 * - コマが終わった欠勤 (今から代わってもらう相手が居ない)
 * - 休む講師がもう担当でないコマ
 * - そのコマに出したままの交代申請がある (代理募集に出したなど。指名の依頼は除く)
 */
export async function getUnfilledDesignatedAbsences(): Promise<
  UnfilledAbsence[]
> {
  const meta = await getSlotMeta();
  const today = jstToday();
  const rows = await db
    .select({
      id: absenceRequests.id,
      tutorId: absenceRequests.tutorId,
      tutorName: profiles.displayName,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
      reason: absenceRequests.reason,
      designatedId: absenceRequests.designatedSubstituteId,
      tutorAssigned: absenceTutorAssigned(),
    })
    .from(absenceRequests)
    .innerJoin(profiles, eq(profiles.id, absenceRequests.tutorId))
    .where(
      and(
        eq(absenceRequests.status, "approved"),
        isNotNull(absenceRequests.designatedSubstituteId),
        gte(absenceRequests.date, today),
      ),
    )
    .orderBy(asc(absenceRequests.date), asc(absenceRequests.slotNumber));
  const candidates = rows.filter(
    (r) =>
      r.tutorAssigned &&
      !isSlotPast(r.date, slotLabelOf(meta, r.slotNumber).end),
  );
  if (candidates.length === 0) return [];

  const [linked, active, names] = await Promise.all([
    db
      .select({
        absenceRequestId: swapRequests.absenceRequestId,
        status: swapRequests.status,
        nominatedTutorId: swapRequests.nominatedTutorId,
        closeKind: swapRequests.closeKind,
      })
      .from(swapRequests)
      .where(
        inArray(
          swapRequests.absenceRequestId,
          candidates.map((c) => c.id),
        ),
      ),
    // そのコマに出したままの交代申請 (代理募集など、欠勤に紐づかないものも)
    db
      .select({
        requesterId: swapRequests.requesterId,
        date: swapRequests.date,
        slotNumber: swapRequests.slotNumber,
      })
      .from(swapRequests)
      .where(
        and(
          inArray(swapRequests.status, ["pending", "approved"]),
          gte(swapRequests.date, today),
          // 指名の依頼 (この欠勤に紐づく) は下の linked で見る
          isNull(swapRequests.absenceRequestId),
          inArray(swapRequests.requesterId, [
            ...new Set(candidates.map((c) => c.tutorId)),
          ]),
        ),
      ),
    // 名前は、指名した相手全員の分を引く (下で linked から集める)
    db
      .select({ id: profiles.id, name: profiles.displayName })
      .from(profiles)
      .innerJoin(swapRequests, eq(swapRequests.nominatedTutorId, profiles.id))
      .where(
        inArray(
          swapRequests.absenceRequestId,
          candidates.map((c) => c.id),
        ),
      ),
  ]);
  const activeKeys = new Set(
    active.map((a) => `${a.requesterId}|${a.date}|${a.slotNumber}`),
  );
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  return candidates.flatMap((c) => {
    if (activeKeys.has(`${c.tutorId}|${c.date}|${c.slotNumber}`)) return [];
    const mine = linked.filter((l) => l.absenceRequestId === c.id);
    const kind = designationState({
      absenceStatus: "approved",
      designatedId: c.designatedId,
      linkedSwaps: mine.map((l) => ({
        status: l.status as LinkedSwap["status"],
        nominatedTutorId: l.nominatedTutorId,
        closeKind: l.closeKind,
      })),
      isEnded: false,
    }).kind;
    if (kind !== "requested" && kind !== "declined") return [];
    const idsOf = (pred: (l: (typeof mine)[number]) => boolean) => [
      ...new Set(
        mine
          .filter(pred)
          .map((l) => l.nominatedTutorId)
          .filter((v): v is string => v !== null),
      ),
    ];
    const waitingIds = idsOf((l) => l.status === "pending");
    const declinedIds = idsOf((l) => l.closeKind === "nominee_declined");
    const nameOf = (id: string) => nameById.get(id) ?? "不明";
    return [
      {
        id: c.id,
        tutorId: c.tutorId,
        tutorName: c.tutorName,
        date: c.date,
        slotNumber: c.slotNumber,
        slotLabel: slotLabelOf(meta, c.slotNumber).label,
        weekdayLabel: weekdayOf(c.date).label,
        reason: c.reason,
        state: kind,
        waitingNames: waitingIds.map(nameOf),
        declinedNames: declinedIds.map(nameOf),
        waitingIds,
        declinedIds,
      },
    ];
  });
}
