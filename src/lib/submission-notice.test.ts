import { describe, expect, it } from "vitest";
import { regularSubmittedNotice } from "./submission-notice";

describe("regularSubmittedNotice (#338)", () => {
  it("名前と開始月を出し、その月の一覧へ飛ぶ", () => {
    expect(regularSubmittedNotice("山田", "2027-05-01")).toEqual({
      type: "shift_submitted",
      title: "山田さんがレギュラーシフトを提出しました",
      body: "2027年5月からの分",
      href: "/admin/fixed-shifts?month=2027-05-01",
    });
  });

  it("月の途中から始まる期でも、一覧はその月の頭を開く", () => {
    expect(regularSubmittedNotice("佐藤", "2026-10-15").href).toBe(
      "/admin/fixed-shifts?month=2026-10-01",
    );
  });
});
