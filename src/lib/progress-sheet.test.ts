import { describe, expect, it } from "vitest";
import { normalizeProgressSheetUrl } from "./progress-sheet";

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
