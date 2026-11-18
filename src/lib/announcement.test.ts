import { describe, expect, it } from "vitest";
import {
  AnnouncementInputSchema,
  announcementPreview,
  MAX_ANNOUNCEMENT_TITLE,
  resolveAnnouncementTitle,
} from "./announcement";

describe("resolveAnnouncementTitle", () => {
  it("件名があればそれを使う", () => {
    expect(resolveAnnouncementTitle(" 来週のシフト ", "本文")).toBe(
      "来週のシフト",
    );
  });

  it("件名が空なら本文の 1 行目 (挨拶の行は飛ばす)", () => {
    expect(
      resolveAnnouncementTitle("", "お疲れ様です。\n\n①シフトについて\n本文"),
    ).toBe("①シフトについて");
  });

  it("挨拶しか無ければ挨拶を使う", () => {
    expect(resolveAnnouncementTitle("", "お疲れ様です。")).toBe(
      "お疲れ様です。",
    );
  });

  it("長い 1 行目は件名の上限で切る", () => {
    const t = resolveAnnouncementTitle("", "あ".repeat(100));
    expect([...t]).toHaveLength(MAX_ANNOUNCEMENT_TITLE);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("announcementPreview", () => {
  it("改行を空白にまとめる", () => {
    expect(announcementPreview("①シフト\n\n②テスト前")).toBe(
      "①シフト ②テスト前",
    );
  });

  it("長い本文は 80 文字で切る", () => {
    const p = announcementPreview("い".repeat(200));
    expect([...p]).toHaveLength(80);
    expect(p.endsWith("…")).toBe(true);
  });
});

describe("AnnouncementInputSchema", () => {
  it("本文が空白だけなら弾く", () => {
    expect(
      AnnouncementInputSchema.safeParse({ title: "", body: "  \n " }).success,
    ).toBe(false);
  });

  it("件名は省略できる", () => {
    expect(
      AnnouncementInputSchema.safeParse({ title: "", body: "本文" }).success,
    ).toBe(true);
  });
});
