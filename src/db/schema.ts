import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
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

/* ------------------------------------------------------------------ */
/*  Enums                                                              */
/* ------------------------------------------------------------------ */

export const userRoleEnum = pgEnum("user_role", ["tutor", "admin"]);

export const periodKindEnum = pgEnum("period_kind", ["normal", "training"]);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const swapKindEnum = pgEnum("swap_kind", [
  "named", // 指名交代
  "open",  // 代講募集
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

/* ------------------------------------------------------------------ */
/*  profiles — Supabase auth.users を 1:1 で拡張                        */
/* ------------------------------------------------------------------ */

export const profiles = pgTable("profiles", {
  // 内部不変 ID。weekly_shifts 等が参照するため auth とは独立に保つ。
  id: uuid("id").primaryKey().defaultRandom(),
  // Supabase auth.users.id。null = まだログインアカウント未連携 (CSV 由来の stub)。
  authUserId: uuid("auth_user_id").unique(),
  displayName: text("display_name").notNull(),
  role: userRoleEnum("role").notNull().default("tutor"),
  email: text("email").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
    kind: periodKindEnum("kind").notNull(),
    name: text("name").notNull(), // 例: "2026年 夏期講習"
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** 講習期間のみ有効。null = 通常期間 */
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
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("training_period_notes_unique").on(t.periodId, t.tutorId),
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
    decidedBy: uuid("decided_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    /** 教室長の判断コメント (却下理由など)。承認時は任意 */
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
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

/* keep sql import used for future defaults (e.g. gen_random_uuid()) */
export const _sql = sql;
