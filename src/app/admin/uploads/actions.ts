"use server";

import { revalidatePath } from "next/cache";
import { arrayContains, inArray, and } from "drizzle-orm";
import iconv from "iconv-lite";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { weekOf, weekRangeLabel } from "@/lib/week";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { pgErrorCode } from "@/lib/db-errors";
import {
  MAX_STUB_TUTORS,
  MAX_TUTOR_NAME,
  planStubTutors,
  stubEmail,
} from "@/lib/stub-tutors";
import type { SkipReason } from "@/lib/swap-reapplication";
import { looksLikeXlsx, xlsxToShiftCsvText } from "@/lib/shift-xlsx";
import {
  parseShiftCsvText,
  ShiftCsvParseError,
  type ParsedShiftCsv,
} from "@/lib/shift-csv-parser";
import {
  commitShiftUpload,
  UploadCommitError,
  type TeacherMapping,
} from "@/lib/upload-commit";
import { getApprovedDayOffs, getDayOffConflicts } from "@/lib/day-offs";
import { dayOffSlotsLabel } from "@/lib/day-off-rule";
import { getSlotMeta } from "@/lib/slot-meta";
import { shiftChangeBody } from "@/lib/shift-change-notice";

/** #360: 取り込む週の承認済みの休み (取り込む前に教室長に見せる) */
export type DayOffNotice = {
  tutorName: string;
  date: string;
  slotsLabel: string;
};

/** #360: 承認済みの休みの日に入ってしまったシフト */
export type DayOffConflictNotice = {
  tutorName: string;
  date: string;
  slotLabel: string;
};

/** 休みの表示は取り込みの本筋ではないので、失敗しても取り込みは止めない */
async function loadDayOffNotices(range: {
  start: string;
  end: string;
}): Promise<DayOffNotice[]> {
  try {
    const [dayOffs, meta] = await Promise.all([
      getApprovedDayOffs(range),
      getSlotMeta(),
    ]);
    return dayOffs.map((d) => ({
      tutorName: d.tutorName,
      date: d.date,
      slotsLabel: dayOffSlotsLabel(
        d.slotNumbers,
        (n) => meta.get(n)?.label ?? `${n}限`,
      ),
    }));
  } catch (e) {
    console.error("loadDayOffNotices failed", e);
    return [];
  }
}

async function loadDayOffConflicts(
  range: { start: string; end: string },
  uploadId: string,
): Promise<DayOffConflictNotice[]> {
  try {
    const [dayOffs, meta] = await Promise.all([
      getApprovedDayOffs(range),
      getSlotMeta(),
    ]);
    const conflicts = await getDayOffConflicts(range, dayOffs, uploadId);
    return conflicts.map((c) => ({
      tutorName: c.tutorName,
      date: c.date,
      slotLabel: meta.get(c.slotNumber)?.label ?? `${c.slotNumber}限`,
    }));
  } catch (e) {
    console.error("loadDayOffConflicts failed", e);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Parse (dry run) — no DB writes                                     */
/* ------------------------------------------------------------------ */

export type ParseUploadResult =
  | {
      ok: true;
      parsed: ParsedShiftCsv;
      originalFilename: string;
      fileBytes: number;
      /** Shift_JIS → UTF-8 化された CSV テキスト。コミット時に再送 */
      rawContent: string;
      /** #360: この週の承認済みの休み */
      dayOffs: DayOffNotice[];
    }
  | { ok: false; error: string };

export async function parseUploadedCsv(
  formData: FormData,
): Promise<ParseUploadResult> {
  await requireRole("admin");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "ファイルが選択されていません。" };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, error: "ファイルサイズが大きすぎます (2MB 上限)。" };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  try {
    // #335: Excel はそのまま受け取り、CSV と同じ形の文字列にする (赤字の生徒には
    // 体験の印が付く)。確定時はこの文字列を解析し直すので、体験も研修も残る
    let rawContent: string;
    if (looksLikeXlsx(buf)) {
      try {
        rawContent = await xlsxToShiftCsvText(buf);
      } catch (e) {
        console.error("xlsxToShiftCsvText failed", e);
        return {
          ok: false,
          error: "Excel ファイルを読めませんでした。座席表の .xlsx か確認してください。",
        };
      }
    } else {
      // BOM 付き UTF-8 だった場合も考慮して、raw を UTF-8 として正規化
      const looksUtf8Bom =
        buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      rawContent = looksUtf8Bom
        ? buf.subarray(3).toString("utf-8")
        : iconv.decode(buf, "shift_jis");
    }
    const parsed = parseShiftCsvText(rawContent);

    return {
      ok: true,
      parsed,
      originalFilename: file.name,
      fileBytes: buf.byteLength,
      rawContent,
      dayOffs: await loadDayOffNotices({
        start: parsed.weekStart,
        end: parsed.weekEnd,
      }),
    };
  } catch (err) {
    if (err instanceof ShiftCsvParseError) {
      return {
        ok: false,
        error: `CSV 解析エラー${err.rowNumber ? `(行 ${err.rowNumber})` : ""}: ${err.message}`,
      };
    }
    console.error("parseUploadedCsv failed", err);
    return {
      ok: false,
      error: "ファイルの解析に失敗しました。CSV の文字コード(Shift_JIS)をご確認ください。",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Commit — writes to DB                                              */
/* ------------------------------------------------------------------ */

export type CommitUploadInput = {
  /**
   * #165 H2: parsed はもう受け取らない。コミット時に rawContent をサーバーで
   * 再解析して信頼された値を使う (クライアント往復の parsed は改竄可能で、
   * 削除範囲 weekStart/weekEnd を任意化できた)。
   */
  rawContent: string;
  originalFilename: string;
  fileBytes: number;
  mappings: TeacherMapping;
};

export type CommitUploadResponse =
  | {
      ok: true;
      uploadId: string;
      insertedShiftRows: number;
      insertedAssignmentRows: number;
      upsertedStudents: number;
      /** #210: 取り込みで消えた承認済み代講のうち復元できた件数 */
      reappliedSwaps: number;
      /** #210: 復元できなかった承認済み代講と、その理由 */
      unreappliedSwaps: {
        swapId: string;
        date: string;
        slotNumber: number;
        reason: SkipReason;
      }[];
      /** #210: approved なのに代講者の記録が無い行の数 */
      missingApplicantSwaps: number;
      /** #360: 承認済みの休みの日に入ってしまったシフト */
      dayOffConflicts: DayOffConflictNotice[];
    }
  | { ok: false; error: string };

export async function commitUploadedCsv(
  input: CommitUploadInput,
): Promise<CommitUploadResponse> {
  const { profile } = await requireRole("admin");

  // Basic shape check
  if (!input?.rawContent || !input.mappings) {
    return { ok: false, error: "送信データが不正です。" };
  }

  // #165: parse-time の 2MB ガードは File にしか掛からず、commit は rawContent
  // 文字列しか見ないため、直接/リプレイ呼び出しで巨大な rawContent を再パース
  // させられる。commit 側でもサイズを制限する。
  if (Buffer.byteLength(input.rawContent, "utf8") > 2 * 1024 * 1024) {
    return { ok: false, error: "データが大きすぎます (2MB 上限)。" };
  }

  // #165 H2: クライアント往復の parsed は信頼せず rawContent を再解析する。
  // これで削除範囲 (weekStart/weekEnd) と各 day.date が parser の検証
  // (1週間以内・範囲内) を必ず通り、改竄値での weekly_shifts 全削除を防ぐ。
  let parsed: ParsedShiftCsv;
  try {
    parsed = parseShiftCsvText(input.rawContent);
  } catch (err) {
    if (err instanceof ShiftCsvParseError) {
      return {
        ok: false,
        error: `CSV 解析エラー${err.rowNumber ? `(行 ${err.rowNumber})` : ""}: ${err.message}`,
      };
    }
    console.error("commitUploadedCsv re-parse failed", err);
    return { ok: false, error: "CSV の再解析に失敗しました。" };
  }

  // #165: originalFilename / fileBytes は監査メタのみ (削除範囲やデータ整合には
  // 無関係) だが、クライアント値をそのまま保存しないよう軽く正規化する。
  const originalFilename =
    typeof input.originalFilename === "string"
      ? input.originalFilename.slice(0, 255)
      : "unknown.csv";
  const fileBytes =
    Number.isFinite(input.fileBytes) && input.fileBytes >= 0
      ? Math.min(Math.trunc(input.fileBytes), 2 * 1024 * 1024)
      : Buffer.byteLength(input.rawContent, "utf8");

  try {
    const result = await commitShiftUpload({
      parsed,
      mappings: input.mappings,
      rawContent: input.rawContent,
      originalFilename,
      fileBytes,
      uploadedBy: profile.id,
    });
    // #317: コマが変わって確認が外れた講師に、確認し直してもらう。取り込み
    // 自体は済んでいるので、通知の失敗で取り込みを失敗扱いにしない
    // (notify は失敗を握り潰す)
    //
    // 室長レビュー要望9: 確認していなかった講師にも、コマが変わったら何が
    // 変わったかを知らせる (未定のコマに授業・体験が入った、など)。確認が
    // 外れた講師には、同じ 1 通で確認し直しも頼む
    const resetTutorIds = new Set(
      result.resetConfirmations.map((r) => r.tutorId),
    );
    const slotMeta = await getSlotMeta().catch(() => null);
    const slotLabel = (n: number) => slotMeta?.get(n)?.label ?? `${n}限`;
    const changedTutorIds = new Set<string>();
    for (const ch of result.shiftChanges) {
      changedTutorIds.add(ch.tutorId);
      const reset = resetTutorIds.has(ch.tutorId);
      await notify([ch.tutorId], {
        type: "shifts_published",
        title: reset
          ? "シフトが変わりました。もう一度確認してください"
          : "シフトが変わりました",
        body:
          shiftChangeBody(ch.changes, slotLabel) +
          (reset ? "。ホームの「確認しました」をもう一度押してください" : ""),
        href: "/tutor",
      });
    }
    for (const r of result.resetConfirmations) {
      if (changedTutorIds.has(r.tutorId)) continue;
      await notify([r.tutorId], {
        type: "shifts_published",
        title: "シフトが変わりました。もう一度確認してください",
        body: `${weekRangeLabel(weekOf(r.weekStart))} の週のシフトが更新されました。ホームの「確認しました」をもう一度押してください`,
        href: "/tutor",
      });
    }
    revalidatePath("/admin/uploads");
    revalidatePath("/admin/weekly");
    revalidatePath("/tutor");
    return {
      ok: true,
      uploadId: result.uploadId,
      insertedShiftRows: result.insertedShiftRows,
      insertedAssignmentRows: result.insertedAssignmentRows,
      upsertedStudents: result.upsertedStudents,
      reappliedSwaps: result.reappliedSwaps,
      unreappliedSwaps: result.unreappliedSwaps,
      missingApplicantSwaps: result.missingApplicantSwaps,
      dayOffConflicts: await loadDayOffConflicts(
        { start: parsed.weekStart, end: parsed.weekEnd },
        result.uploadId,
      ),
    };
  } catch (err) {
    console.error("commitUploadedCsv failed", err);
    // #165: 業務エラー (対応付け未完了等) のみ文言を返す。DB の生エラーは
    // 内部情報を露出しないよう汎用文言にする。ただし「時間をおいて再度」だと
    // 決定論的失敗 (制約違反等) を transient と誤認させ無限リトライを招くため、
    // 原因確認と管理者連絡を促す文言にする (詳細は console.error に残る)。
    if (err instanceof UploadCommitError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error:
        "取り込みに失敗しました。CSV の内容と講師の割り当てをご確認ください。解決しない場合は管理者へご連絡ください。",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  未登録の講師を「ログイン未連携」で作る                               */
/* ------------------------------------------------------------------ */

const StubTutorsInput = z.object({
  names: z
    .array(z.string().trim().min(1).max(MAX_TUTOR_NAME))
    .min(1)
    .max(MAX_STUB_TUTORS),
});

export type CreateStubTutorsResult =
  | {
      ok: true;
      /** 名前 → 講師 id。新しく作った人と、同名で既にいた人の両方 */
      tutors: { name: string; id: string; email: string }[];
    }
  | { ok: false; error: string };

/**
 * CSV の講師名のうち、講師アカウントが無いものを「ログイン未連携」で作る。
 * 作る前に画面で名前を見せ、教室長が押したときだけ呼ばれる (打ち間違いで
 * 別人が増えないよう、取り込みのときに黙って作ることはしない)。
 *
 * 同名の有効な講師がいれば作らずにその id を返す。同名の講師が無効化されて
 * いれば、表示名の一意制約に当たるので作らずに断る (有効化を案内する)。
 */
export async function createStubTutors(
  input: unknown,
): Promise<CreateStubTutorsResult> {
  await requireRole("admin");

  const parsed = StubTutorsInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "講師名が正しくありません（1 人 50 文字まで）。" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const names = [...new Set(parsed.data.names)];
      const same = await tx
        .select({
          id: profiles.id,
          displayName: profiles.displayName,
          email: profiles.email,
          isActive: profiles.isActive,
        })
        .from(profiles)
        .where(
          and(
            arrayContains(profiles.roles, ["tutor"]),
            inArray(profiles.displayName, names),
          ),
        );
      const plan = planStubTutors(names, same);
      if (!plan.ok) return plan;

      const created =
        plan.toCreate.length === 0
          ? []
          : await tx
              .insert(profiles)
              .values(
                plan.toCreate.map((displayName) => {
                  const id = crypto.randomUUID();
                  return { id, displayName, email: stubEmail(id), isActive: true };
                }),
              )
              .returning({
                id: profiles.id,
                name: profiles.displayName,
                email: profiles.email,
              });
      const emailById = new Map(same.map((t) => [t.id, t.email]));
      return {
        ok: true as const,
        tutors: [
          ...plan.existing.map((e) => ({
            name: e.name,
            id: e.id,
            email: emailById.get(e.id) ?? "",
          })),
          ...created,
        ],
      };
    });

    if (!result.ok) {
      return {
        ok: false,
        error: `同じ名前の講師が無効化されています: ${result.inactiveNames.join("、")}。講師一覧で有効化してから対応付けてください。`,
      };
    }
    revalidatePath("/admin/uploads");
    revalidatePath("/admin/tutors");
    return result;
  } catch (err) {
    // 同時に同じ名前を作ったとき (表示名の一意制約)
    if (pgErrorCode(err) === "23505") {
      return {
        ok: false,
        error: "同じ名前の講師が同時に作られました。画面を読み直してから、もう一度お試しください。",
      };
    }
    console.error("createStubTutors failed", err);
    return { ok: false, error: "講師を作れませんでした。時間をおいてもう一度お試しください。" };
  }
}
