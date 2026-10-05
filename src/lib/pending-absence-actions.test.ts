import { describe, expect, it } from "vitest";
import { pendingAbsenceActions } from "@/lib/pending-absence-actions";

describe("pendingAbsenceActions (#289)", () => {
  it("今も担当なら従来どおり承認 / 却下 (閉じる操作は出さない)", () => {
    expect(
      pendingAbsenceActions({ tutorAssigned: true, isEnded: false }),
    ).toEqual({
      canApprove: true,
      canReject: true,
      canClose: false,
      showEndedHint: false,
      notice: null,
    });
    // 終わったコマは「承認して構いません」を添える (#211)
    expect(
      pendingAbsenceActions({ tutorAssigned: true, isEnded: true })
        .showEndedHint,
    ).toBe(true);
  });

  it("担当でない・まだ来ていないコマは「不要として閉じる」だけ", () => {
    const a = pendingAbsenceActions({ tutorAssigned: false, isEnded: false });
    expect(a).toMatchObject({
      canApprove: false,
      canReject: false,
      canClose: true,
    });
    expect(a.notice).toBe(
      "このコマは今は担当ではありません（担当が変わったか、コマが無くなりました）。この欠勤申請は不要なので「不要として閉じる」を押してください。",
    );
  });

  it("担当でない・終わったコマは、承認 (休んだ記録) か不要として閉じる", () => {
    const a = pendingAbsenceActions({ tutorAssigned: false, isEnded: true });
    expect(a).toMatchObject({
      canApprove: true,
      canReject: false,
      canClose: true,
    });
    expect(a.notice).toContain("実際に休んだ記録として残すなら承認");
    // 案内は 1 つにまとめる (「承認して構いません」と食い違わせない)
    expect(a.showEndedHint).toBe(false);
  });

  it("担当でないときは却下を出さない (「出勤しろ」と読めるため)", () => {
    for (const isEnded of [false, true]) {
      expect(
        pendingAbsenceActions({ tutorAssigned: false, isEnded }).canReject,
      ).toBe(false);
    }
  });
});
