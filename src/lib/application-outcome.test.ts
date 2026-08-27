import { describe, expect, it } from "vitest";
import {
  applicationOutcome,
  OUTCOME_LABEL,
} from "@/lib/application-outcome";

describe("applicationOutcome", () => {
  it("承認は「自分が選ばれたか」で意味が正反対になる", () => {
    // status だけで分岐すると、落選を「決まりました」と出す
    expect(applicationOutcome("approved", true)).toBe("chosen");
    expect(applicationOutcome("approved", false)).toBe("not-chosen");
  });

  it("却下と取り下げは chosen に依らない", () => {
    expect(applicationOutcome("rejected", false)).toBe("rejected");
    expect(applicationOutcome("rejected", true)).toBe("rejected");
    expect(applicationOutcome("cancelled", false)).toBe("withdrawn");
    expect(applicationOutcome("cancelled", true)).toBe("withdrawn");
  });

  it("ラベルを丸ごと固定する", () => {
    // 画面はラベルを並べるだけにするので、ラベルが製品面そのもの
    expect(OUTCOME_LABEL).toEqual({
      chosen: "あなたに決まりました",
      "not-chosen": "他の講師に決まりました",
      rejected: "却下されました",
      withdrawn: "取り下げられました",
    });
  });
});
