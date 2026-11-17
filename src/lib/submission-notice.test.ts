import { describe, expect, it } from "vitest";
import {
  absenceRequestedNotice,
  regularSubmittedNotice,
} from "./submission-notice";

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

describe("absenceRequestedNotice (#338)", () => {
  it("誰の・どのコマの・理由を出し、申請承認へ飛ぶ", () => {
    expect(
      absenceRequestedNotice("山田", "2026-11-20", "3限", "体調不良"),
    ).toEqual({
      type: "absence_requested",
      title: "山田さんから欠勤申請が届きました",
      body: "対象: 2026-11-20 3限 ／ 理由: 体調不良",
      href: "/admin/requests",
    });
  });

  it("長い理由は頭の 60 字で切る", () => {
    const n = absenceRequestedNotice(
      "山田",
      "2026-11-20",
      "3限",
      "あ".repeat(100),
    );
    expect(n.body).toBe(`対象: 2026-11-20 3限 ／ 理由: ${"あ".repeat(60)}…`);
  });
});
