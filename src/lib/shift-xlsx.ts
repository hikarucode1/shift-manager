import "server-only";
import ExcelJS from "exceljs";

/**
 * #335: 座席表の Excel (.xlsx) を、これまでの CSV と同じ形の文字列にする。
 *
 * 教室長は Excel で体験授業の生徒を赤字にしている (研修は「研修」と書く)。
 * CSV にすると色が消えるので、Excel のまま受け取り、赤字の生徒には
 * {@link TRIAL_PREFIX} を付けて CSV にする。あとは CSV の解析にそのまま乗る
 * (取り込みの確定時も、保存した CSV を解析し直すだけで体験が分かる)。
 */

/** 体験授業の生徒の印。CSV で手で書いても同じ意味になる */
export const TRIAL_PREFIX = "【体験】";

/** .xlsx (zip) か。先頭が "PK" */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/** 赤っぽい文字色か (FF0000 のほか、濃い赤 C00000 なども) */
export function isRedArgb(argb: string | undefined): boolean {
  if (!argb || !/^[0-9a-fA-F]{6,8}$/.test(argb)) return false;
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r >= 0xc0 && g < 0x60 && b < 0x60;
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** セルの値を CSV と同じ書き方の文字列にする */
function cellText(value: ExcelJS.CellValue, isDateColumn: boolean): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // 日付行は CSV で "11月18日"。Excel の日付は UTC の 0 時で入る
    const m = value.getUTCMonth() + 1;
    const d = value.getUTCDate();
    return isDateColumn
      ? `${m}月${d}日`
      : `${value.getUTCFullYear()}/${m}/${d}`;
  }
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue, isDateColumn);
    return "";
  }
  return String(value);
}

/** 文字色が赤か (リッチテキストは一部でも赤なら赤) */
function cellIsRed(cell: ExcelJS.Cell): boolean {
  const v = cell.value;
  if (v && typeof v === "object" && "richText" in v) {
    return v.richText.some((t) => isRedArgb(t.font?.color?.argb));
  }
  return isRedArgb(cell.font?.color?.argb);
}

export async function xlsxToShiftCsvText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  // exceljs の型は古い Buffer を前提にしているので ArrayBuffer で渡す
  await wb.xlsx.load(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  // 「座席表」で始まるシートを使う (メモ用のシートが並んでいることがある)
  const sheet =
    wb.worksheets.find(
      (ws) => cellText(ws.getCell(1, 1).value, false).trim() === "座席表",
    ) ?? wb.worksheets[0];
  if (!sheet) return "";

  const lines: string[] = [];
  const width = Math.max(6, sheet.columnCount);
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const first = cellText(row.getCell(1).value, false).trim();
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      let text = cellText(cell.value, first === "日付" && c === 2);
      // 生徒の欄 (3 列目以降) の赤字 = 体験授業。見出し行・研修は除く
      if (
        c >= 3 &&
        text.trim() !== "" &&
        text.trim() !== "研修" &&
        first !== "座番" &&
        first !== "日付" &&
        !/^\d+限$/.test(first) &&
        cellIsRed(cell)
      ) {
        text = `${TRIAL_PREFIX}${text.trim()}`;
      }
      cells.push(text);
    }
    // 末尾の空欄は落とす (CSV と同じく可変長でよい)
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    lines.push(cells.map(csvField).join(","));
  }
  return lines.join("\r\n");
}
