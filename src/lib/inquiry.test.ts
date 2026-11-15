import { describe, expect, it } from "vitest";
import {
  buildInquiryMail,
  formatJstDateTime,
  InquiryInputSchema,
  roleLabel,
  sanitizePagePath,
} from "./inquiry";

describe("sanitizePagePath", () => {
  it("アプリ内のパスは残す", () => {
    expect(sanitizePagePath("/tutor/shifts?week=2026-11-16")).toBe(
      "/tutor/shifts?week=2026-11-16",
    );
  });
  it("外のURL・プロトコル相対・改行・長すぎは捨てる", () => {
    expect(sanitizePagePath("https://evil.example/")).toBeNull();
    expect(sanitizePagePath("//evil.example/")).toBeNull();
    expect(sanitizePagePath("/a\nb")).toBeNull();
    expect(sanitizePagePath("/" + "a".repeat(300))).toBeNull();
    expect(sanitizePagePath(null)).toBeNull();
  });
});

describe("InquiryInputSchema", () => {
  const base = { kind: "bug", wantsReply: false, pagePath: null };
  it("空白だけの内容は断る", () => {
    expect(InquiryInputSchema.safeParse({ ...base, body: "  \n " }).success).toBe(false);
  });
  it("2001 文字は断る", () => {
    expect(InquiryInputSchema.safeParse({ ...base, body: "あ".repeat(2001) }).success).toBe(false);
    expect(InquiryInputSchema.safeParse({ ...base, body: "あ".repeat(2000) }).success).toBe(true);
  });
  it("知らない種類は断る", () => {
    expect(InquiryInputSchema.safeParse({ ...base, kind: "spam", body: "x" }).success).toBe(false);
  });
});

describe("roleLabel", () => {
  it("兼任も出す", () => {
    expect(roleLabel(["admin", "tutor"])).toBe("教室長・講師");
    expect(roleLabel(["tutor"])).toBe("講師");
    expect(roleLabel(["admin"])).toBe("教室長");
  });
});

describe("buildInquiryMail", () => {
  it("件名に種類・名前・役割、本文に画面と内容を入れる", () => {
    const m = buildInquiryMail({
      id: "id-1",
      kind: "bug",
      body: "保存できません",
      pagePath: "/tutor/fixed-shifts",
      wantsReply: true,
      senderName: "山田",
      senderEmail: "yamada@example.com",
      senderRoles: ["tutor"],
      userAgent: "UA",
      createdAt: new Date("2026-11-14T09:30:00Z"),
    });
    expect(m.subject).toBe("【Shift Manager】不具合の報告: 山田さん（講師）");
    expect(m.text).toContain("日時: 2026/11/14 18:30");
    expect(m.text).toContain("画面: /tutor/fixed-shifts");
    expect(m.text).toContain("返信: ほしい");
    expect(m.text.endsWith("保存できません")).toBe(true);
  });
});

describe("formatJstDateTime", () => {
  it("日付をまたぐ時刻も JST で出す", () => {
    expect(formatJstDateTime(new Date("2026-11-14T15:05:00Z"))).toBe("2026/11/15 00:05");
  });
});
