import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PreferredStudent } from "@/lib/preferred-students";

/* ------------------------------------------------------------------ */
/*  Enums                                                              */
/* ------------------------------------------------------------------ */

export const userRoleEnum = pgEnum("user_role", ["tutor", "admin"]);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

/**
 * 欠勤申請がどう閉じたか (#292)。`status = 'cancelled'` の行にだけ入る。
 * 以前は自由文の `decision_note` と `decided_by` の組み合わせで見分けていたが、
 * 教室長の取り消し理由が定型文と偶然一致すると分類が変わり、`decided_by` は
 * 教室長の削除で null になるので、専用の列にした。
 */
export const absenceCloseKindEnum = pgEnum("absence_close_kind", [
  "tutor_withdraw", // 講師本人が pending を取り下げた
  "admin_cancel", // 教室長が approved を取り消した (cancelApprovedAbsence)
  "unassigned", // 担当でないため教室長が不要として閉じた (#290)
  "auto_expired", // 交代成立で元講師がコマを失い自動失効 (#225)
  "expired_unassigned", // 代講の取り消しで代講者がコマを失い自動失効 (#291)
]);

export type AbsenceCloseKind = (typeof absenceCloseKindEnum.enumValues)[number];

/**
 * 交代・代講申請がどう閉じたか (#293)。`status = 'cancelled'` の行にだけ入る
 * (却下は `rejected` で別)。欠勤の `absence_close_kind` (#292) と同じ作り。
 */
export const swapCloseKindEnum = pgEnum("swap_close_kind", [
  "tutor_withdraw", // 講師本人が pending を取り下げた (cancelSwapRequest)
  "admin_withdraw", // 教室長が代理募集を取り下げた (cancelOpenSwapOnBehalf, #231)
  "admin_cancel", // 教室長が承認済みを取り消した (cancelApprovedSwap, #213)
  // 担当が変わって承認できなくなったので、システムが閉じた (#293)。代講の
  // 記録 (#253) で元講師の募集、代講の取り消し (#287) で代講者の募集
  "unassignable",
  // 欠勤で教室長が指定した相手が、代講の依頼を断った (#331)
  "nominee_declined",
]);

export type SwapCloseKind = (typeof swapCloseKindEnum.enumValues)[number];

export const swapKindEnum = pgEnum("swap_kind", [
  "named", // 指名交代
  "open",  // 代講募集
  // #215: 募集も応募も経由せず、教室長が「誰が入ったか」を直接記録したもの。
  // named/open はどちらも「講師が誰かに代わってもらう依頼」を表すので、
  // 起きていない募集を主張しないために別の値にする。
  "recorded",
]);

export const weekdayEnum = pgEnum("weekday", [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

// レギュラー固定シフトの3値希望 (Issue #55)。yes=〇 出勤可、maybe=△ 可だが避けたい、no=× 不可
// 行不在は「未回答」を意味し、UI 側で "no" として扱う (互換性のため)
export const shiftAvailabilityEnum = pgEnum("shift_availability", [
  "yes",
  "maybe",
  "no",
]);

// レギュラー提出単位の状態 (Issue #61)。
// draft: 講師が編集可能。saveFixedShifts はこの状態にのみ上書きする
// submitted: 講師が「提出」ボタンを押した状態。締切前なら下書きに戻せる
// frozen: 締切後 or admin による強制凍結。講師は何もできず、admin の介入で解除
export const shiftSubmissionStatusEnum = pgEnum("shift_submission_status", [
  "draft",
  "submitted",
  "frozen",
]);

// アプリ内通知の種別 (Issue #155 第一段階)。
// absence_result: 欠勤申請の承認/却下、swap_result: 交代・代講申請の結果、
// shifts_published: 確定シフトの公開
export const notificationTypeEnum = pgEnum("notification_type", [
  "absence_result",
  "swap_result",
  "shifts_published",
  // #155 後続: 新規の交代/代講募集 (open=応募資格者へ, named=指名先へ)
  "swap_posted",
  // #344: 教室長宛て。欠勤で指定した代講の相手が引き受けた / 断った (#331)
  "substitute_response",
  // #338: 教室長宛て。講師がレギュラーシフトを提出した
  "shift_submitted",
  // #338: 教室長宛て。講師が欠勤申請を出した (承認待ち)
  "absence_requested",
  // #333: 教室長宛て。講師が提出期間外のシフト変更を申請した
  "shift_change_requested",
  // #333: 講師宛て。変更申請が承認・却下された
  "shift_change_result",
  // #333: 教室長宛て。承認された変更を講師が出し直した / 終えた
  "shift_change_done",
  // #360: 教室長宛て。講師が先の日の休み希望を出した
  "day_off_requested",
  // #360: 講師宛て。休み希望が承認・却下された
  "day_off_result",
  // 講師宛て。教室長が出したお知らせ (LINE で送っていた連絡の代わり)
  "announcement",
]);

/* ------------------------------------------------------------------ */
/*  profiles — Supabase auth.users を 1:1 で拡張                        */
/* ------------------------------------------------------------------ */

export const profiles = pgTable("profiles", {
  // 内部不変 ID。weekly_shifts 等が参照するため auth とは独立に保つ。
  id: uuid("id").primaryKey().defaultRandom(),
  // Supabase auth.users.id。null = まだログインアカウント未連携 (CSV 由来の stub)。
  authUserId: uuid("auth_user_id").unique(),
  displayName: text("display_name").notNull(),
  // #111: 1 profile が複数 role を兼任できる (例: 教室長が講師も担当)。
  // 旧 role 単一値を roles 配列に置換。判定は「指定 role を含むか」(contains)。
  roles: userRoleEnum("roles").array().notNull().default(["tutor"]),
  email: text("email").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  /** #348: 理系 / 文系 / どちらも (science / humanities / both)。未登録は null */
  track: text("track"),
  /** #348: 担当できる科目の key (`src/lib/tutor-subjects.ts`)。未登録は空 */
  teachableSubjects: text("teachable_subjects").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  // 講師の表示名は一意 (CSV 自動マッチ tutors.find(displayName===name) の
  // 取り違えを根治)。tutor role を含まない profile は対象外なので partial unique。
  tutorNameUniq: uniqueIndex("profiles_tutor_name_uniq")
    .on(t.displayName)
    .where(sql`'tutor' = ANY(${t.roles})`),
}));

/* ------------------------------------------------------------------ */
/*  slot_definitions — 1限 / 2限 ... の時間帯定義                        */
/* ------------------------------------------------------------------ */

export const slotDefinitions = pgTable(
  "slot_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 1 = 1限 */
    slotNumber: smallint("slot_number").notNull(),
    label: text("label").notNull(), // 例: "1限"
    startTime: text("start_time").notNull(), // "17:00"
    endTime: text("end_time").notNull(), // "18:30"
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slotNumberUnique: unique("slot_definitions_slot_number_unique").on(
      t.slotNumber,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  periods — 通常 / 講習期間                                           */
/* ------------------------------------------------------------------ */

export const periods = pgTable(
  "periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 例: "2026年 夏期講習"
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** 講習希望の提出締切。#110 で kind 撤廃後は全期間=講習期間で必須運用 */
    submissionDeadline: timestamp("submission_deadline", {
      withTimezone: true,
    }),
    /** 締切後に再開放した場合 true */
    isReopened: boolean("is_reopened").notNull().default(false),
    /** アーカイブ (論理削除)。true = 管理一覧から隠す。履歴は保持 */
    isArchived: boolean("is_archived").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dateIdx: index("periods_date_idx").on(t.startDate, t.endDate),
  }),
);

/* ------------------------------------------------------------------ */
/*  fixed_shifts — 通常期間の固定シフト (曜日 × コマ)                    */
/* ------------------------------------------------------------------ */

export const fixedShifts = pgTable(
  "fixed_shifts",
  {
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    weekday: weekdayEnum("weekday").notNull(),
    slotNumber: smallint("slot_number").notNull(),
    /** この設定の適用開始日 */
    effectiveFrom: date("effective_from").notNull(),
    /** Issue #55: 3値希望。既存行は yes でバックフィル */
    availability: shiftAvailabilityEnum("availability").notNull().default("yes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.tutorId, t.weekday, t.slotNumber, t.effectiveFrom],
    }),
    tutorIdx: index("fixed_shifts_tutor_idx").on(t.tutorId),
  }),
);

/* ------------------------------------------------------------------ */
/*  monthly_submission_periods — 月別レギュラー提出期間 (Issue #60)      */
/* ------------------------------------------------------------------ */
/*  教室長が「対象月 / 提出開始 / 提出締切」を月単位で指定するエンティティ。 */
/*  fixed_shift_submissions.period_id から参照される。                  */
/*  既存 periods (通常 / 講習) とは用途が異なるため別テーブル。           */

export const monthlySubmissionPeriods = pgTable(
  "monthly_submission_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 対象月の 1 日 (例: 2026-07-01 = 2026年7月分)。月単位の一意制約あり */
    targetMonth: date("target_month").notNull(),
    /** 講師の提出可能開始日時 */
    submissionOpensAt: timestamp("submission_opens_at", { withTimezone: true }).notNull(),
    /** 講師の提出締切日時。締切後は強制凍結 (B2 で実装) */
    submissionDueAt: timestamp("submission_due_at", { withTimezone: true }).notNull(),
    /** アーカイブ (論理削除)。一覧から隠すが履歴は保持 */
    isArchived: boolean("is_archived").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // PR #66 Round 3 P1-B: アクティブ (= 未 archived) な行に限定した unique index。
    // 全件 unique にすると「誤って archived → 同月を作り直したい」が永続的に詰む。
    // 部分 unique で論理削除と再作成を共存させる (`absence_requests_active_uniq`,
    // `swap_requests_active_uniq` の既存パターンに整合)。
    targetMonthActiveUniq: uniqueIndex(
      "monthly_submission_periods_target_month_active_uniq",
    )
      .on(t.targetMonth)
      .where(sql`${t.isArchived} = false`),
    // PR #66 Round 3 P2-A: アプリ層の zod 検証を bypass する経路 (service_role 直接 SQL、
    // CSV/import、将来の他クライアント) からの不正データを DB 層で塞ぐ。
    targetMonthIsFirstOfMonth: check(
      "monthly_submission_periods_target_month_first_of_month_chk",
      sql`${t.targetMonth} = date_trunc('month', ${t.targetMonth})::date`,
    ),
    opensBeforeDue: check(
      "monthly_submission_periods_opens_before_due_chk",
      sql`${t.submissionOpensAt} < ${t.submissionDueAt}`,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  regular_shift_periods — 期 (可変長) マスタ (Issue #71)            */
/* ------------------------------------------------------------------ */
/*  業務実態: 4月頭に提出 → 6月末まで持つ = 期 (3ヶ月程度、可変長)。     */
/*  monthly_submission_periods (月単位) を置換する第 2 段階の起点。     */
/*  日付単位 (月初制約なし) で期中始動 (例: 4/16 〜) も許容。            */
/*  label は admin 手動 ("2026年春期 (4-6月)" 等)、業務ラベルに揃える。   */
/*  旧 monthly_submission_periods は β/γ 完了後に別 PR で廃止予定。       */

export const regularShiftPeriods = pgTable(
  "regular_shift_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** admin 手動入力 (例: "2026年春期 (4-6月)") */
    label: text("label").notNull(),
    /** 期の開始日 (日付単位、月初制約なし — 4/16 始動も可) */
    startDate: date("start_date").notNull(),
    /** 期の終了日 (start_date 以降) */
    endDate: date("end_date").notNull(),
    /** 講師の提出可能開始日時 */
    submissionOpensAt: timestamp("submission_opens_at", {
      withTimezone: true,
    }).notNull(),
    /** 講師の提出締切日時。締切後は強制凍結 */
    submissionDueAt: timestamp("submission_due_at", {
      withTimezone: true,
    }).notNull(),
    /** アーカイブ (論理削除)。一覧から隠すが履歴は保持 */
    isArchived: boolean("is_archived").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // DB 層で日付順序を強制 (アプリ層 zod を bypass する経路への防御)
    dateRangeChk: check(
      "regular_shift_periods_date_range_chk",
      sql`${t.startDate} <= ${t.endDate}`,
    ),
    opensBeforeDueChk: check(
      "regular_shift_periods_opens_before_due_chk",
      sql`${t.submissionOpensAt} < ${t.submissionDueAt}`,
    ),
    // Issue #82 (1): 提出締切は期終了日以降になり得ない (業務上「期内に締切」が常に真)。
    // submission_due_at は timestamptz、end_date は date。session timezone (Supabase は UTC)
    // 依存の `::date` キャストだと JST 7/1 00:00–09:00 が UTC 6/30 23:59–7/1 00:00 となり
    // end_date=6/30 を擦り抜けるため、JST で date 化してから比較する。
    dueWithinPeriodChk: check(
      "regular_shift_periods_due_within_period_chk",
      sql`(${t.submissionDueAt} AT TIME ZONE 'Asia/Tokyo')::date <= ${t.endDate}`,
    ),
    // 一覧の主ソート用 (is_archived asc → start_date desc 想定)
    activeStartIdx: index("regular_shift_periods_active_start_idx").on(
      t.isArchived,
      t.startDate,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  fixed_shift_submissions — レギュラー提出単位のメタ (Issue #57/#59)  */
/* ------------------------------------------------------------------ */
/*  fixed_shifts 1行 = 1セル (講師×曜日×コマ×effective_from) なので、    */
/*  講師×提出単位 (= effective_from) で 1 行のメタを別テーブルに分離。    */
/*  B1 (#60) で period_id FK を追加し月別提出期間と紐付け。              */

export const fixedShiftSubmissions = pgTable(
  "fixed_shift_submissions",
  {
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    /** Issue #58: 適用終了日 (任意, null = 無期限)。提出単位のメタとして保持。
     *  当初は fixed_shifts に置く設計だったが、entries 空 (全コマ不可) のとき
     *  fixed_shifts に行が 1 件もなくなり終了日が消える PR #65 のレビュー指摘で移管。 */
    effectiveTo: date("effective_to"),
    /** Issue #57: 希望出勤日数 (整数, 任意) */
    desiredDays: smallint("desired_days"),
    /** Issue #57: 希望出勤コマ数 (整数, 任意) */
    desiredSlots: smallint("desired_slots"),
    /** Issue #59: フリースペース */
    note: text("note"),
    /**
     * #319: 担当したい生徒・教科 (任意)。[{ student, subject }] の配列。
     * 生徒名で検索・集計する予定が無く、提出単位で丸ごと読み書きするので
     * 別テーブルにせず jsonb にした。読むときは parseStoredPreferredStudents を通す
     */
    preferredStudents: jsonb("preferred_students")
      .$type<PreferredStudent[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Issue #72 (β): 紐付く期 (任意, null = 未紐付け = アドホック提出)。旧 monthly_submission_periods 参照から regular_shift_periods 参照へ差し替え。 */
    periodId: uuid("period_id").references(() => regularShiftPeriods.id, {
      onDelete: "set null",
    }),
    /** Issue #61: 提出状態。default は draft で saveFixedShifts は draft 上書き専用 */
    status: shiftSubmissionStatusEnum("status").notNull().default("draft"),
    /** Issue #61: submitted へ遷移した時刻 (submit 時に now() を書く)。下書き状態では null */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** PR #67 R-3: 監査ログ。状態遷移 (insert 含む) のたびに更新 */
    lastStatusChangedAt: timestamp("last_status_changed_at", {
      withTimezone: true,
    }),
    /** PR #67 R-3: 状態を遷移させたユーザ。tutor 自身 or admin (frozen 操作) */
    lastStatusChangedBy: uuid("last_status_changed_by").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tutorId, t.effectiveFrom] }),
    periodIdx: index("fixed_shift_submissions_period_idx").on(t.periodId),
    // PR #67 R-2: status と submitted_at の不変条件を DB 層で保証する。
    // - submitted → submitted_at は必ず NOT NULL
    // - draft    → submitted_at は必ず NULL
    // - frozen   → どちらでも可 (admin 経由で submitted を frozen に上書きしても、
    //              逆に draft を直接 frozen にしても破綻しない)
    statusInvariant: check(
      "fixed_shift_submissions_status_submitted_at_chk",
      sql`(${t.status} = 'submitted' AND ${t.submittedAt} IS NOT NULL)
        OR (${t.status} = 'draft' AND ${t.submittedAt} IS NULL)
        OR (${t.status} = 'frozen')`,
    ),
    // #165: 同種テーブル (regular_assignments 等) と揃えて期間の整合を DB 層でも
    // 保証。アプリ (saveFixedShifts) でも検証済みだが最終防御。
    // #319: jsonb は何でも入るので、最低限「配列であること」だけ DB で保証する
    preferredStudentsArray: check(
      "fixed_shift_submissions_preferred_students_array_chk",
      sql`jsonb_typeof(${t.preferredStudents}) = 'array'`,
    ),
    effectiveRange: check(
      "fixed_shift_submissions_effective_range_chk",
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  regular_assignments — 教室長が確定したレギュラー枠 (期間ベース)     */
/* ------------------------------------------------------------------ */
/*  Issue #74 (δ): 旧 monthly_regular_assignments (月単位) を effective_*/
/*  ベースに再設計。「5/16 以降の某講師の火曜を外す」のような日単位の例外 */
/*  を表現するため、effective_from / effective_to で適用日付範囲を持つ。  */
/*  期マスタ (regular_shift_periods) との紐付けで「どの期に属する確定か」*/
/*  を保持。同一 (period_id, tutor_id, weekday, slot_number) で時間的に */
/*  重ならない複数行を許容する想定 (重なり検出はアプリ層 + 後追い Issue)。  */

export const regularAssignments = pgTable(
  "regular_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 紐付く期 (期マスタ削除時は確定もカスケード削除) */
    periodId: uuid("period_id")
      .notNull()
      .references(() => regularShiftPeriods.id, { onDelete: "cascade" }),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    weekday: weekdayEnum("weekday").notNull(),
    slotNumber: smallint("slot_number").notNull(),
    /** 適用開始日 (inclusive)。期途中変更は新しい effective_from の行を INSERT */
    effectiveFrom: date("effective_from").notNull(),
    /** 適用終了日 (inclusive)。NULL は許容しない (#87): admin 確定行は必ず period.end_date を入れる。 */
    effectiveTo: date("effective_to").notNull(),
    /** 確定操作した admin。確定状態の責任所在を残すため null 不可 */
    confirmedBy: uuid("confirmed_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    /** 確定時刻。bulk save の transaction 内で同じ now() を打つ */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    weekdayNotSun: check(
      "regular_assignments_weekday_not_sun_chk",
      sql`${t.weekday} <> 'sun'`,
    ),
    slotRange: check(
      "regular_assignments_slot_range_chk",
      sql`${t.slotNumber} BETWEEN 1 AND 20`,
    ),
    dateRange: check(
      "regular_assignments_date_range_chk",
      sql`${t.effectiveFrom} <= ${t.effectiveTo}`,
    ),
    // 講師ページ (自分の有効な確定を取得) 用
    tutorPeriodIdx: index("regular_assignments_tutor_period_idx").on(
      t.tutorId,
      t.periodId,
    ),
    // admin 期一覧の取得用
    periodIdx: index("regular_assignments_period_idx").on(t.periodId),
  }),
);

/* ------------------------------------------------------------------ */
/*  course_confirmations — 教室長が確定した講習シフト枠 (Issue #75 ε)    */
/* ------------------------------------------------------------------ */
/*  講習 (periods.kind = "training") に対して、教室長が「この日、このコマ */
/*  にこの講師を出勤させる」と確定する単位。training_preferences の希望  */
/*  から admin が複数選択して bulk save する想定。                     */
/*  1 コマに複数講師許可 (アシスタント・複数セクション運用)、PK は         */
/*  (period_id, date, slot_number, tutor_id) 複合。                  */

export const courseConfirmations = pgTable(
  "course_confirmations",
  {
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "cascade" }),
    /** 講習日 (period の start_date 〜 end_date 内、アプリ層で検証) */
    date: date("date").notNull(),
    slotNumber: smallint("slot_number").notNull(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    confirmedBy: uuid("confirmed_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.periodId, t.date, t.slotNumber, t.tutorId],
    }),
    slotRange: check(
      "course_confirmations_slot_range_chk",
      sql`${t.slotNumber} BETWEEN 1 AND 20`,
    ),
    // admin 俯瞰: 期内の日×コマで誰が確定しているか
    periodDateIdx: index("course_confirmations_period_date_idx").on(
      t.periodId,
      t.date,
      t.slotNumber,
    ),
    // 講師 view: 自分の確定シフトを期で取得
    tutorPeriodIdx: index("course_confirmations_tutor_period_idx").on(
      t.tutorId,
      t.periodId,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  training_preferences — 講習期間の日別希望                           */
/* ------------------------------------------------------------------ */

export const trainingPreferences = pgTable(
  "training_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "cascade" }),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    slotNumber: smallint("slot_number").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("training_preferences_unique").on(
      t.periodId,
      t.tutorId,
      t.date,
      t.slotNumber,
    ),
    lookupIdx: index("training_preferences_lookup_idx").on(
      t.periodId,
      t.date,
      t.slotNumber,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  training_period_notes — 講習希望の期間単位の備考 (講師×期間で1件)   */
/* ------------------------------------------------------------------ */

export const trainingPeriodNotes = pgTable(
  "training_period_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "cascade" }),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    /** #319: テスト期間 (任意)。開始と終了は両方入っているか両方空 */
    testFrom: date("test_from"),
    testTo: date("test_to"),
    /** #319: 夏休み (任意)。開始と終了は両方入っているか両方空 */
    summerFrom: date("summer_from"),
    summerTo: date("summer_to"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("training_period_notes_unique").on(t.periodId, t.tutorId),
    // #319: checkDateRange (src/lib/training-ranges.ts) と同じ条件
    testRange: check(
      "training_period_notes_test_range_chk",
      sql`(${t.testFrom} IS NULL AND ${t.testTo} IS NULL)
        OR (${t.testFrom} IS NOT NULL AND ${t.testTo} IS NOT NULL AND ${t.testFrom} <= ${t.testTo})`,
    ),
    summerRange: check(
      "training_period_notes_summer_range_chk",
      sql`(${t.summerFrom} IS NULL AND ${t.summerTo} IS NULL)
        OR (${t.summerFrom} IS NOT NULL AND ${t.summerTo} IS NOT NULL AND ${t.summerFrom} <= ${t.summerTo})`,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  shift_uploads — Excel アップロードの履歴                            */
/* ------------------------------------------------------------------ */

export const shiftUploads = pgTable("shift_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => profiles.id, { onDelete: "restrict" }),
  /** 対象週の月曜日 */
  weekStart: date("week_start").notNull(),
  /** 対象週の日曜日 */
  weekEnd: date("week_end").notNull(),
  /** Supabase Storage のオブジェクトキー (将来 Storage 移行時に使用) */
  storagePath: text("storage_path"),
  /** 元 CSV の生テキスト (Shift_JIS から UTF-8 化済み)。監査・再解析用 */
  rawContent: text("raw_content").notNull(),
  originalFilename: text("original_filename").notNull(),
  fileBytes: integer("file_bytes").notNull(),
  /** 解析時の警告・メタ情報 (JSON 文字列) */
  parseMeta: text("parse_meta"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  weekly_shifts — Excel から読み取った確定シフト                       */
/* ------------------------------------------------------------------ */

export const weeklyShifts = pgTable(
  "weekly_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => shiftUploads.id, { onDelete: "cascade" }),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    slotNumber: smallint("slot_number").notNull(),
    /** 座席番号 (CSV の 座番)。未確定の場合 null */
    seatNumber: text("seat_number"),
    /** 代講・差替によって元と変わっている場合に true */
    isOverride: boolean("is_override").notNull().default(false),
    /** #335: 研修のコマ (座席表の生徒の欄に「研修」、または「全体研修」の行) */
    isTraining: boolean("is_training").notNull().default(false),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("weekly_shifts_unique").on(t.uploadId, t.tutorId, t.date, t.slotNumber),
    dateSlotIdx: index("weekly_shifts_date_slot_idx").on(t.date, t.slotNumber),
    tutorIdx: index("weekly_shifts_tutor_idx").on(t.tutorId, t.date),
  }),
);

/* ------------------------------------------------------------------ */
/*  students — 生徒マスタ (CSV から自動登録)                             */
/* ------------------------------------------------------------------ */

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** 名寄せ用の正規化キー (name と同じにしておき、必要になれば別途) */
    nameKey: text("name_key").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameKeyUnique: unique("students_name_key_unique").on(t.nameKey),
  }),
);

/* ------------------------------------------------------------------ */
/*  shift_assignments — 確定シフト内の生徒割り当て (最大2名 / slot)       */
/* ------------------------------------------------------------------ */

export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weeklyShiftId: uuid("weekly_shift_id")
      .notNull()
      .references(() => weeklyShifts.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    /** 科目コード (例: 英/数/国/理/社/物理/化学/古典/算/他/数Ⅰ ...) */
    subject: text("subject").notNull(),
    /** 1 または 2 (左席 / 右席) */
    position: smallint("position").notNull(),
    /** #335: 体験授業の生徒 (座席表の赤字) */
    isTrial: boolean("is_trial").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    positionUnique: unique("shift_assignments_position_unique").on(
      t.weeklyShiftId,
      t.position,
    ),
    studentIdx: index("shift_assignments_student_idx").on(t.studentId),
  }),
);

/* ------------------------------------------------------------------ */
/*  absence_requests — 欠勤申請                                         */
/* ------------------------------------------------------------------ */

export const absenceRequests = pgTable(
  "absence_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    slotNumber: smallint("slot_number").notNull(),
    reason: text("reason").notNull(),
    status: requestStatusEnum("status").notNull().default("pending"),
    /**
     * この行を作った人 (#217)。講師本人の申請なら `tutor_id` と同じ、教室長の
     * 代理登録なら教室長の id が入る。**両者は他のどの列でも区別できない**
     * (代理登録も承認済みとして入るので `decided_by` は両方とも教室長になる)。
     * 「本人が申告したのか、聞き取って入れたのか」は勤怠でモメたときに要る。
     * #217 以前の行は null (不明)。
     */
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** 教室長の判断コメント (却下理由など)。承認時は任意 */
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /**
     * 閉じ方の種類 (#292)。`cancelled` の行にだけ入る。種類の判定はこの列だけで
     * 行い、`decision_note` の文言や `decided_by` の有無を見ないこと。
     * 0037 で既存の行を埋め、0041 で「cancelled なら必ず入る」制約を足した (#309)
     */
    closeKind: absenceCloseKindEnum("close_kind"),
    /**
     * #331: 欠勤を承認するときに教室長が指定した「代講を頼む相手」(任意)。
     * 休む講師はこの相手に代講を依頼し (swap_requests.absence_request_id で
     * この欠勤に紐づく)、相手が引き受けるとその場で成立する
     */
    designatedSubstituteId: uuid("designated_substitute_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("absence_requests_status_idx").on(t.status),
    tutorDateIdx: index("absence_requests_tutor_date_idx").on(
      t.tutorId,
      t.date,
    ),
    // 同一コマに有効な申請 (pending/approved) は1件まで。
    // 重複チェックと INSERT の TOCTOU を DB レベルで根治。
    activeUniq: uniqueIndex("absence_requests_active_uniq")
      .on(t.tutorId, t.date, t.slotNumber)
      .where(sql`${t.status} in ('pending','approved')`),
    // #309: 取り消し済みなら閉じ方が必ず入っている。逆 (取り消し以外なら空) は
    // 縛らない。取り消しから戻す経路ができたときに、ここで落ちないように
    cancelledHasCloseKind: check(
      "absence_requests_cancelled_close_kind_chk",
      sql`${t.status} <> 'cancelled' OR ${t.closeKind} IS NOT NULL`,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  swap_requests — 交代・代講申請                                      */
/* ------------------------------------------------------------------ */

export const swapRequests = pgTable(
  "swap_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: swapKindEnum("kind").notNull(),
    /**
     * この行を作った人 (#227)。講師本人の申請なら `requester_id` と同じ、
     * 教室長の代理募集なら教室長の id。**両者は他のどの列でも区別できない**
     * (`requester_id` は「休む講師」なので代理でも本人になる)。
     * 「私は交代を頼んでいない」に答えられる必要がある。#227 以前は null。
     */
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** 指名交代時のみ */
    nominatedTutorId: uuid("nominated_tutor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    date: date("date").notNull(),
    slotNumber: smallint("slot_number").notNull(),
    reason: text("reason").notNull(),
    status: requestStatusEnum("status").notNull().default("pending"),
    /** 代講募集の場合、承認時に確定した応募者 */
    approvedApplicantId: uuid("approved_applicant_id").references(
      () => profiles.id,
      { onDelete: "set null" },
    ),
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** 教室長の判断コメント (却下理由など) */
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /**
     * 閉じ方の種類 (#293)。`cancelled` の行にだけ入る。種類の判定はこの列だけで
     * 行い、`decided_by` や `approved_applicant_id` の有無では判定しない。
     * 0038 で既存の行を埋め、0041 で「cancelled なら必ず入る」制約を足した (#309)
     */
    closeKind: swapCloseKindEnum("close_kind"),
    /**
     * #331: 欠勤で教室長が指定した相手への代講依頼のとき、その欠勤。
     * これがある named の依頼は、相手が引き受けた時点で成立する (教室長の
     * 承認を待たない。相手は教室長が既に決めているため)
     */
    absenceRequestId: uuid("absence_request_id").references(
      () => absenceRequests.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("swap_requests_status_idx").on(t.status),
    dateIdx: index("swap_requests_date_idx").on(t.date, t.slotNumber),
    // 同一講師が同一コマに有効な交代申請を重複させない
    activeUniq: uniqueIndex("swap_requests_active_uniq")
      .on(t.requesterId, t.date, t.slotNumber)
      .where(sql`${t.status} = 'pending'`),
    // #309: absence_requests と同じ (取り消し済みなら閉じ方が必ず入っている)
    cancelledHasCloseKind: check(
      "swap_requests_cancelled_close_kind_chk",
      sql`${t.status} <> 'cancelled' OR ${t.closeKind} IS NOT NULL`,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  swap_applications — 代講募集への応募                                */
/* ------------------------------------------------------------------ */

export const swapApplications = pgTable(
  "swap_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    swapRequestId: uuid("swap_request_id")
      .notNull()
      .references(() => swapRequests.id, { onDelete: "cascade" }),
    applicantId: uuid("applicant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    note: text("note"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("swap_applications_unique").on(
      t.swapRequestId,
      t.applicantId,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  Relations                                                          */
/* ------------------------------------------------------------------ */

export const profilesRelations = relations(profiles, ({ many }) => ({
  fixedShifts: many(fixedShifts),
  trainingPreferences: many(trainingPreferences),
  weeklyShifts: many(weeklyShifts),
  absenceRequests: many(absenceRequests),
  swapRequests: many(swapRequests),
  swapApplications: many(swapApplications),
}));

export const periodsRelations = relations(periods, ({ one, many }) => ({
  creator: one(profiles, {
    fields: [periods.createdBy],
    references: [profiles.id],
  }),
  trainingPreferences: many(trainingPreferences),
}));

export const fixedShiftsRelations = relations(fixedShifts, ({ one }) => ({
  tutor: one(profiles, {
    fields: [fixedShifts.tutorId],
    references: [profiles.id],
  }),
}));

export const fixedShiftSubmissionsRelations = relations(
  fixedShiftSubmissions,
  ({ one }) => ({
    tutor: one(profiles, {
      fields: [fixedShiftSubmissions.tutorId],
      references: [profiles.id],
    }),
    period: one(regularShiftPeriods, {
      fields: [fixedShiftSubmissions.periodId],
      references: [regularShiftPeriods.id],
    }),
  }),
);

export const monthlySubmissionPeriodsRelations = relations(
  monthlySubmissionPeriods,
  ({ one, many }) => ({
    creator: one(profiles, {
      fields: [monthlySubmissionPeriods.createdBy],
      references: [profiles.id],
    }),
    submissions: many(fixedShiftSubmissions),
  }),
);

export const regularShiftPeriodsRelations = relations(
  regularShiftPeriods,
  ({ one }) => ({
    creator: one(profiles, {
      fields: [regularShiftPeriods.createdBy],
      references: [profiles.id],
    }),
  }),
);

export const trainingPreferencesRelations = relations(
  trainingPreferences,
  ({ one }) => ({
    tutor: one(profiles, {
      fields: [trainingPreferences.tutorId],
      references: [profiles.id],
    }),
    period: one(periods, {
      fields: [trainingPreferences.periodId],
      references: [periods.id],
    }),
  }),
);

export const shiftUploadsRelations = relations(shiftUploads, ({ one, many }) => ({
  uploader: one(profiles, {
    fields: [shiftUploads.uploadedBy],
    references: [profiles.id],
  }),
  weeklyShifts: many(weeklyShifts),
}));

export const weeklyShiftsRelations = relations(weeklyShifts, ({ one, many }) => ({
  upload: one(shiftUploads, {
    fields: [weeklyShifts.uploadId],
    references: [shiftUploads.id],
  }),
  tutor: one(profiles, {
    fields: [weeklyShifts.tutorId],
    references: [profiles.id],
  }),
  assignments: many(shiftAssignments),
}));

export const studentsRelations = relations(students, ({ many }) => ({
  assignments: many(shiftAssignments),
}));

export const shiftAssignmentsRelations = relations(shiftAssignments, ({ one }) => ({
  weeklyShift: one(weeklyShifts, {
    fields: [shiftAssignments.weeklyShiftId],
    references: [weeklyShifts.id],
  }),
  student: one(students, {
    fields: [shiftAssignments.studentId],
    references: [students.id],
  }),
}));

export const absenceRequestsRelations = relations(absenceRequests, ({ one }) => ({
  tutor: one(profiles, {
    fields: [absenceRequests.tutorId],
    references: [profiles.id],
  }),
  decider: one(profiles, {
    fields: [absenceRequests.decidedBy],
    references: [profiles.id],
  }),
}));

export const swapRequestsRelations = relations(swapRequests, ({ one, many }) => ({
  requester: one(profiles, {
    fields: [swapRequests.requesterId],
    references: [profiles.id],
  }),
  nominatedTutor: one(profiles, {
    fields: [swapRequests.nominatedTutorId],
    references: [profiles.id],
  }),
  approvedApplicant: one(profiles, {
    fields: [swapRequests.approvedApplicantId],
    references: [profiles.id],
  }),
  applications: many(swapApplications),
}));

export const swapApplicationsRelations = relations(swapApplications, ({ one }) => ({
  swapRequest: one(swapRequests, {
    fields: [swapApplications.swapRequestId],
    references: [swapRequests.id],
  }),
  applicant: one(profiles, {
    fields: [swapApplications.applicantId],
    references: [profiles.id],
  }),
}));

/* ------------------------------------------------------------------ */
/*  notifications — アプリ内通知 (Issue #155)                           */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: notificationTypeEnum().notNull(),
    /**
     * #344: どの画面のベルに出すか。兼任 (教室長かつ講師) の人でも、講師の
     * ベルには講師向けだけ、教室長のベルには教室長向けだけを出す。既読も
     * 画面ごとに分かれる。既存の行はすべて講師向けなので default は tutor
     */
    audience: userRoleEnum("audience").notNull().default("tutor"),
    title: text().notNull(),
    body: text(),
    /** タップ時の遷移先 (アプリ内パス) */
    href: text(),
    /**
     * #155 review: 重複送信を冪等に防ぐためのキー (例: 確定シフト公開の periodId)。
     * title 文字列だと同名期で衝突するため専用列に分離。null の通知 (申請結果など)
     * は重複排除しない — Postgres の unique index は NULL を distinct 扱いするため
     * 下の uniqueIndex には引っかからない。
     */
    dedupKey: text("dedup_key"),
    /** null = 未読 */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // 未読件数の取得 (recipient_id + read_at IS NULL) と一覧 (新着順) 用
    recipientReadIdx: index("notifications_recipient_read_idx").on(
      t.recipientId,
      t.readAt,
    ),
    recipientCreatedIdx: index("notifications_recipient_created_idx").on(
      t.recipientId,
      t.createdAt,
    ),
    // #155 review: (宛先, 種別, dedupKey) で冪等化。check-then-insert では
    // 2 管理者の同時押下で二重通知になるため、DB unique + onConflictDoNothing で
    // アトミックに防ぐ。dedupKey NULL の行は distinct 扱いで重複可 (申請結果など)。
    dedupUniq: uniqueIndex("notifications_dedup_uniq").on(
      t.recipientId,
      t.type,
      t.dedupKey,
    ),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(profiles, {
    fields: [notifications.recipientId],
    references: [profiles.id],
  }),
}));

/* keep sql import used for future defaults (e.g. gen_random_uuid()) */
export const _sql = sql;

/* ------------------------------------------------------------------ */
/*  inquiries — アプリ内の「お問い合わせ」(#320)                        */
/* ------------------------------------------------------------------ */
/*  講師・教室長が送った質問・不具合の報告・要望。開発者へのメールが     */
/*  落ちても消えないよう、先にここへ保存してからメールを送る。           */

export const inquiryKindEnum = pgEnum("inquiry_kind", [
  "question",
  "bug",
  "request",
]);

export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 送った人。退職などで profile が消えても問い合わせは残す */
    senderId: uuid("sender_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** 送った時点の名前・メール・役割 (後で profile が変わっても当時のまま) */
    senderName: text("sender_name").notNull(),
    senderEmail: text("sender_email").notNull(),
    senderRoles: text("sender_roles").array().notNull(),
    kind: inquiryKindEnum("kind").notNull(),
    body: text("body").notNull(),
    /** どの画面から開いたか (アプリ内のパス)。分からなければ null */
    pagePath: text("page_path"),
    wantsReply: boolean("wants_reply").notNull().default(false),
    userAgent: text("user_agent"),
    /** 開発者へのメールが送れた時刻。null = 未送信 (未設定・失敗) */
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdIdx: index("inquiries_created_idx").on(t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/*  shift_confirmations — 講師が公開済みの週のシフトを確認した記録 (#317) */
/* ------------------------------------------------------------------ */
/*  LINE のスタンプの代わり。講師 × 週 (月曜の日付) で 1 行。座席表を    */
/*  取り込み直してコマ (日付 × 何限) が変わった講師の行だけ消し、確認し  */
/*  直してもらう (担当する生徒だけの変更では消さない。本人の判断)。       */

export const shiftConfirmations = pgTable(
  "shift_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** 週の月曜 (YYYY-MM-DD) */
    weekStart: date("week_start").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("shift_confirmations_tutor_week_unique").on(
      t.tutorId,
      t.weekStart,
    ),
    weekIdx: index("shift_confirmations_week_idx").on(t.weekStart),
  }),
);

/* ------------------------------------------------------------------ */
/*  app_settings — 教室全体の設定 (キーと値) (#339)                     */
/* ------------------------------------------------------------------ */
/*  最初の 1 つは進行表 (Google スプレッドシート) の URL。教室長が登録し、 */
/*  講師のホームと教室長のダッシュボードから開く。                        */

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  /** 最後に変えた教室長。退職などで消えても設定は残す */
  updatedBy: uuid("updated_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  push_subscriptions — スマホ通知 (Web Push) の宛先 (#318)            */
/* ------------------------------------------------------------------ */
/**
 * 1 端末 (ブラウザ) = 1 行。同じ人がスマホと PC で ON にすれば 2 行になる。
 * endpoint はブラウザが発行する宛先 URL で、端末ごとに一意。
 *
 * 期限切れ (Push サービスが 404/410 を返した) の行は送信時に消す。
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    /** 暗号化用の鍵 (ブラウザの PushSubscription.keys) */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    endpointUniq: uniqueIndex("push_subscriptions_endpoint_uniq").on(
      t.endpoint,
    ),
    profileIdx: index("push_subscriptions_profile_idx").on(t.profileId),
  }),
);

/* ------------------------------------------------------------------ */
/*  shift_change_requests — 提出期間外のシフト変更申請 (#333)            */
/* ------------------------------------------------------------------ */
export const shiftChangeKindEnum = pgEnum("shift_change_kind", [
  "regular",
  "training",
]);

export const shiftChangeStatusEnum = pgEnum("shift_change_status", [
  "pending",
  "approved",
  "rejected",
  // 講師が出し直した / 終えた、取り下げた、期限が切れた
  "closed",
]);

/**
 * 提出期間の外でレギュラー・講習の希望を変えたいときの申請。教室長が承認すると
 * `unlocked_until` まで**その講師だけ**編集できる (承認 = 中身の承認ではなく、
 * 変えることの許可)。講習は教室長が申請なしで 1 人だけ再開することもある
 * (`reason` に教室長の操作であることを書く)。
 *
 * - regular: `regular_period_id` = 変える期 (null = 期が 1 つも無い)
 * - training: `training_period_id` = 変える講習期間
 */
/** shift_change_requests.regular_snapshot の中身 (日時は ISO 文字列) */
export type RegularSnapshot = {
  /**
   * 戻す範囲 (effective_from の日付)。この範囲の行を消してから控えを入れ直す。
   * 期が無く、元の提出も無いときは null
   */
  scope: { from: string; to: string } | null;
  submissions: Array<
    Omit<
      typeof fixedShiftSubmissions.$inferSelect,
      "submittedAt" | "lastStatusChangedAt" | "createdAt" | "updatedAt"
    > & {
      submittedAt: string | null;
      lastStatusChangedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }
  >;
  shifts: Array<
    Omit<typeof fixedShifts.$inferSelect, "createdAt"> & { createdAt: string }
  >;
};

export const shiftChangeRequests = pgTable(
  "shift_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: shiftChangeKindEnum("kind").notNull(),
    regularPeriodId: uuid("regular_period_id").references(
      () => regularShiftPeriods.id,
      { onDelete: "cascade" },
    ),
    trainingPeriodId: uuid("training_period_id").references(() => periods.id, {
      onDelete: "cascade",
    }),
    reason: text("reason").notNull(),
    status: shiftChangeStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** 承認したときだけ入る。これを過ぎると編集できない */
    unlockedUntil: timestamp("unlocked_until", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * レギュラーの承認時に、下書きに戻す前の提出を丸ごと控えておく。
     * 期限までに出し直さなかったら、これに戻して直しかけの下書きを捨てる
     */
    regularSnapshot: jsonb("regular_snapshot").$type<RegularSnapshot>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindTarget: check(
      "shift_change_requests_kind_target",
      sql`(${t.kind} = 'regular' and ${t.trainingPeriodId} is null) or (${t.kind} = 'training' and ${t.trainingPeriodId} is not null and ${t.regularPeriodId} is null)`,
    ),
    // 1 人につき、レギュラーは 1 件、講習は期間ごとに 1 件まで (申請中 + 承認中)
    activeRegularUniq: uniqueIndex("shift_change_requests_active_regular_uniq")
      .on(t.tutorId)
      .where(
        sql`${t.kind} = 'regular' and ${t.status} in ('pending','approved')`,
      ),
    activeTrainingUniq: uniqueIndex(
      "shift_change_requests_active_training_uniq",
    )
      .on(t.tutorId, t.trainingPeriodId)
      .where(
        sql`${t.kind} = 'training' and ${t.status} in ('pending','approved')`,
      ),
    statusIdx: index("shift_change_requests_status_idx").on(
      t.status,
      t.createdAt,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  day_off_requests — 先の日の休み希望 (#360)                          */
/* ------------------------------------------------------------------ */
/*  確定シフトがまだ公開されていない日に「この日は休みたい」を出す。       */
/*  欠勤 (absence_requests) はシフトのあるコマが対象で代講探しにつながる  */
/*  ので分けた。承認済みの日は、シフトを作るとき教室長の画面に出す。       */

export const dayOffRequests = pgTable(
  "day_off_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** 休みたいコマ。空なら終日 */
    slotNumbers: smallint("slot_numbers")
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    reason: text("reason").notNull(),
    status: requestStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** 教室長のコメント (却下のときは必須) */
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tutorDateIdx: index("day_off_requests_tutor_date_idx").on(
      t.tutorId,
      t.date,
    ),
    statusDateIdx: index("day_off_requests_status_date_idx").on(
      t.status,
      t.date,
    ),
  }),
);

/* ------------------------------------------------------------------ */
/*  announcements — 教室長から講師全員へのお知らせ                     */
/* ------------------------------------------------------------------ */
/*  今まで LINE でシフトと一緒に送っていた連絡を、教室長が好きなときに   */
/*  アプリから出す。送った時点の在籍講師を announcement_recipients に   */
/*  1 行ずつ作り、講師が「確認しました」を押すと confirmed_at が入る     */
/*  (LINE のスタンプの代わり)。                                         */

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** 出した教室長。退職などで消えてもお知らせは残す */
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdIdx: index("announcements_created_idx").on(t.createdAt),
  }),
);

export const announcementRecipients = pgTable(
  "announcement_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** null = まだ「確認しました」を押していない */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => ({
    uniq: unique("announcement_recipients_announcement_tutor_unique").on(
      t.announcementId,
      t.tutorId,
    ),
    // 講師ホームの「未確認のお知らせ」用
    tutorConfirmedIdx: index("announcement_recipients_tutor_confirmed_idx").on(
      t.tutorId,
      t.confirmedAt,
    ),
  }),
);
