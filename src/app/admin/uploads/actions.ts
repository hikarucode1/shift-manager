"use server";

import { revalidatePath } from "next/cache";
import iconv from "iconv-lite";
import { requireRole } from "@/lib/auth";
import {
  parseShiftCsvBuffer,
  parseShiftCsvText,
  ShiftCsvParseError,
  type ParsedShiftCsv,
} from "@/lib/shift-csv-parser";
import {
  commitShiftUpload,
  UploadCommitError,
  type TeacherMapping,
} from "@/lib/upload-commit";

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
    const parsed = parseShiftCsvBuffer(buf);

    // BOM 付き UTF-8 だった場合も考慮して、raw を UTF-8 として正規化
    const looksUtf8Bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const rawContent = looksUtf8Bom
      ? buf.subarray(3).toString("utf-8")
      : iconv.decode(buf, "shift_jis");

    return {
      ok: true,
      parsed,
      originalFilename: file.name,
      fileBytes: buf.byteLength,
      rawContent,
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
    revalidatePath("/admin/uploads");
    revalidatePath("/admin/weekly");
    revalidatePath("/tutor");
    return {
      ok: true,
      uploadId: result.uploadId,
      insertedShiftRows: result.insertedShiftRows,
      insertedAssignmentRows: result.insertedAssignmentRows,
      upsertedStudents: result.upsertedStudents,
    };
  } catch (err) {
    console.error("commitUploadedCsv failed", err);
    // #165: 業務エラー (対応付け未完了等) のみ文言を返す。DB の生エラーは
    // 内部情報を露出しないよう汎用文言にする。
    if (err instanceof UploadCommitError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: "取り込みに失敗しました。時間をおいて再度お試しください。",
    };
  }
}
