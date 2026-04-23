"use server";

import { revalidatePath } from "next/cache";
import iconv from "iconv-lite";
import { requireRole } from "@/lib/auth";
import {
  parseShiftCsvBuffer,
  ShiftCsvParseError,
  type ParsedShiftCsv,
} from "@/lib/shift-csv-parser";
import { commitShiftUpload, type TeacherMapping } from "@/lib/upload-commit";

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
  parsed: ParsedShiftCsv;
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
  if (!input?.parsed?.weekStart || !input.rawContent || !input.mappings) {
    return { ok: false, error: "送信データが不正です。" };
  }

  try {
    const result = await commitShiftUpload({
      parsed: input.parsed,
      mappings: input.mappings,
      rawContent: input.rawContent,
      originalFilename: input.originalFilename,
      fileBytes: input.fileBytes,
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
    const msg = err instanceof Error ? err.message : "保存に失敗しました。";
    return { ok: false, error: msg };
  }
}
