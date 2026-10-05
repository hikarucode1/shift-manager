import { describe, expect, it } from "vitest";
import { approvalNotice, EXPIRED_ABSENCE_NOTICE } from "@/lib/approval-notice";

describe("approvalNotice (#278)", () => {
  it("失効が無ければ承認の一文だけで、自動で消してよい", () => {
    expect(approvalNotice("佐藤", 0)).toEqual({
      text: "佐藤 を代講者として承認しました。",
      sticky: false,
    });
  });

  it("失効があれば知らせを足し、自動では消さない", () => {
    expect(approvalNotice("佐藤", 1)).toEqual({
      text: `佐藤 を代講者として承認しました。${EXPIRED_ABSENCE_NOTICE}`,
      sticky: true,
    });
  });

  it("「欠勤の記録」と言わない (未承認の申請だけが失効することがある, #250)", () => {
    expect(EXPIRED_ABSENCE_NOTICE).toContain("欠勤申請");
    expect(EXPIRED_ABSENCE_NOTICE).not.toContain("記録は");
  });
});
