import { describe, expect, it } from "vitest";
import {
  applicationOutcome,
  canSeeDecisionNote,
  OUTCOME_LABEL,
  toApplicationRow,
  type ApplicationRowInput,
} from "@/lib/application-outcome";

describe("applicationOutcome", () => {
  it("承認は「自分が選ばれたか」で意味が正反対になる", () => {
    // status だけで分岐すると、落選を「決まりました」と出す
    expect(applicationOutcome("approved", true, true, true)).toBe("chosen");
    expect(applicationOutcome("approved", false, true, true)).toBe("not-chosen");
  });

  it("却下は chosen / wasApproved に依らない", () => {
    expect(applicationOutcome("rejected", false, false, true)).toBe("rejected");
    expect(applicationOutcome("rejected", true, true, true)).toBe("rejected");
  });

  it("取り消しは「一度承認されたか」で分ける", () => {
    // 落選者から見ると「募集が取り下げられた」と「決まった代講が後から
    // 取り消された」は別の出来事
    expect(applicationOutcome("cancelled", false, false, true)).toBe("withdrawn");
    expect(applicationOutcome("cancelled", false, true, true)).toBe(
      "cancelled-after-approval",
    );
    expect(applicationOutcome("cancelled", true, true, true)).toBe(
      "cancelled-after-approval",
    );
  });

  it("応募していないのに代講者なら教室長の記録 (#215 / #247)", () => {
    // 「決まりました」と出すと、申し込んだ覚えのないものを申し込んだことになる
    expect(applicationOutcome("approved", true, true, false)).toBe("recorded");
    expect(applicationOutcome("approved", true, true, true)).toBe("chosen");
  });

  it("記録された代講が後から取り消されたら cancelled-after-approval", () => {
    // 応募していなくても、一度承認された事実 (approved_applicant_id) は残る
    expect(applicationOutcome("cancelled", true, true, false)).toBe(
      "cancelled-after-approval",
    );
  });

  it("ラベルを丸ごと固定する", () => {
    // 画面はラベルを並べるだけにするので、ラベルが製品面そのもの
    expect(OUTCOME_LABEL).toEqual({
      chosen: "あなたに決まりました",
      recorded: "教室長が代講として記録しました",
      "not-chosen": "他の講師に決まりました",
      rejected: "却下されました",
      withdrawn: "取り下げられました",
      "cancelled-after-approval": "決まった代講が取り消されました",
    });
  });
});

describe("canSeeDecisionNote", () => {
  it("承認後の取り消し理由は、選ばれた本人にしか見せない", () => {
    // 理由は「決まった代講者」についての説明で、落選者宛ではない
    // (例:「B が体調不良で来られなくなったため」)
    expect(canSeeDecisionNote("cancelled-after-approval", true)).toBe(true);
    expect(canSeeDecisionNote("cancelled-after-approval", false)).toBe(false);
  });

  it("募集全体についての理由は全員に見せる", () => {
    // 却下理由・取り下げ理由は #244 の通知でも全応募者に送っている
    for (const chosen of [true, false]) {
      expect(canSeeDecisionNote("rejected", chosen)).toBe(true);
      expect(canSeeDecisionNote("withdrawn", chosen)).toBe(true);
      expect(canSeeDecisionNote("chosen", chosen)).toBe(true);
      expect(canSeeDecisionNote("recorded", chosen)).toBe(true);
      expect(canSeeDecisionNote("not-chosen", chosen)).toBe(true);
    }
  });
});

describe("toApplicationRow", () => {
  const row = (o: Partial<ApplicationRowInput> = {}): ApplicationRowInput => ({
    id: "req-1",
    status: "approved",
    date: "2026-08-20",
    slotNumber: 3,
    slotLabel: "3限",
    weekdayLabel: "木",
    requesterName: "山田",
    applicationId: "app-1",
    approvedApplicantId: "me",
    note: null,
    decidedAt: "2026-08-27T05:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...o,
  });

  it("応募して選ばれた行は chosen", () => {
    expect(toApplicationRow(row(), "me")?.outcome).toBe("chosen");
  });

  it("応募行が無いのに代講者なら recorded (#247 の核心)", () => {
    // ここが #248 のレビューまで無検証だった。applicationId を見ずに
    // 常に applied=true にすると、教室長の記録が「決まりました」になる
    expect(toApplicationRow(row({ applicationId: null }), "me")?.outcome).toBe(
      "recorded",
    );
  });

  it("代講者が自分でなければ not-chosen", () => {
    expect(
      toApplicationRow(row({ approvedApplicantId: "other" }), "me")?.outcome,
    ).toBe("not-chosen");
  });

  it("pending は null を返す (キャストで型任せにしない)", () => {
    expect(toApplicationRow(row({ status: "pending" }), "me")).toBeNull();
    expect(toApplicationRow(row({ status: "unknown-future" }), "me")).toBeNull();
  });

  it("承認後の取り消しは、選ばれた本人にだけ理由を見せる", () => {
    const base = { status: "cancelled", note: "B が来られなくなったため" };
    expect(
      toApplicationRow(row({ ...base, approvedApplicantId: "me" }), "me")?.note,
    ).toBe("B が来られなくなったため");
    expect(
      toApplicationRow(row({ ...base, approvedApplicantId: "other" }), "me")
        ?.note,
    ).toBeNull();
  });

  it("却下理由は落選者にも見せる (募集全体についての説明なので)", () => {
    expect(
      toApplicationRow(
        row({
          status: "rejected",
          approvedApplicantId: null,
          note: "別途調整済みのため",
        }),
        "me",
      )?.note,
    ).toBe("別途調整済みのため");
  });

  it("decidedAt が無ければ updatedAt を使う (#233 と同じ規則)", () => {
    expect(toApplicationRow(row({ decidedAt: null }), "me")?.decidedAt).toBe(
      "2026-08-21T00:00:00.000Z",
    );
  });

  it("素通しの列が入れ替わっていないこと", () => {
    expect(toApplicationRow(row({ applicationId: null }), "me")).toEqual({
      id: "req-1",
      date: "2026-08-20",
      slotNumber: 3,
      slotLabel: "3限",
      weekdayLabel: "木",
      requesterName: "山田",
      outcome: "recorded",
      note: null,
      decidedAt: "2026-08-27T05:00:00.000Z",
    });
  });
});
