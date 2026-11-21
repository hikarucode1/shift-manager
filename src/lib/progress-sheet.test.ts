import { describe, expect, it } from "vitest";
import { normalizeProgressSheetUrl, SHEET_LINKS } from "./progress-sheet";

describe("normalizeProgressSheetUrl (#339)", () => {
  it("スプレッドシートの URL はそのまま受け付ける (前後の空白は落とす)", () => {
    expect(
      normalizeProgressSheetUrl(
        "  https://docs.google.com/spreadsheets/d/abc123/edit#gid=0 \n",
      ),
    ).toEqual({
      ok: true,
      url: "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0",
    });
  });
  it("空なら登録を消す", () => {
    expect(normalizeProgressSheetUrl("   ")).toEqual({ ok: true, url: null });
  });
  it.each([
    ["URL でない", "進行表"],
    ["http", "http://docs.google.com/spreadsheets/d/abc"],
    ["別のサイト", "https://example.com/spreadsheets/d/abc"],
    ["似せたホスト", "https://docs.google.com.evil.example/spreadsheets/d/abc"],
    ["ドキュメント", "https://docs.google.com/document/d/abc"],
    ["javascript", "javascript:alert(1)"],
  ])("%s は受け付けない", (_, input) => {
    expect(normalizeProgressSheetUrl(input).ok).toBe(false);
  });
});

describe("SHEET_LINKS (室長レビュー要望13)", () => {
  it("進行表と講師マニュアルは別のキーに保存する", () => {
    expect(SHEET_LINKS.progress.key).toBe("progress_sheet_url");
    expect(SHEET_LINKS.manual.key).toBe("tutor_manual_url");
  });
});
