import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { looksLikeXlsx, xlsxToShiftCsvText } from "./shift-xlsx";

const RED = { argb: "FFFF0000" };

async function book(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("メモ").getCell("A1").value = "関係ないシート";
  const ws = wb.addWorksheet("原本");
  ws.addRow(["座席表", "表示期間", "2026/11/16〜2026/11/22"]);
  ws.addRow(["日付", new Date(Date.UTC(2026, 10, 18)), "水"]);
  ws.addRow(["8限", "19:30〜20:55"]);
  ws.addRow(["座番", "講師", "生徒", "生徒"]);
  ws.addRow([1, "山田太郎", "川口花子(数B)", "佐藤花子(英)"]);
  ws.addRow([2, "鈴木一郎", "研修"]);
  ws.getCell("C5").font = { color: RED };
  ws.getCell("C6").font = { color: RED };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("xlsxToShiftCsvText (#335)", () => {
  it("座席表シートを CSV にし、赤字の生徒だけに【体験】を付ける", async () => {
    const buf = await book();
    expect(looksLikeXlsx(buf)).toBe(true);
    const lines = (await xlsxToShiftCsvText(buf)).split("\r\n");
    expect(lines[1]).toContain("11月18日");
    expect(lines).toContainEqual(
      expect.stringContaining("【体験】川口花子(数B)"),
    );
    expect(lines.join("\n")).not.toContain("【体験】佐藤");
    // 赤字でも「研修」はそのまま
    expect(lines.join("\n")).not.toContain("【体験】研修");
  });

  it("CSV のバイト列は xlsx と見なさない", () => {
    expect(looksLikeXlsx(Buffer.from("座席表,表示期間"))).toBe(false);
  });
});
