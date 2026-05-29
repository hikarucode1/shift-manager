import { describe, it, expect } from "vitest";
import {
  classifyTransition,
  isValidStatusTransition,
  type ShiftSubmissionStatus,
} from "./shift-submission-state";

const ALL_STATES: ShiftSubmissionStatus[] = ["draft", "submitted", "frozen"];

describe("isValidStatusTransition", () => {
  it("allows all same-state no-op transitions (UPDATE that does not touch status)", () => {
    for (const s of ALL_STATES) {
      expect(isValidStatusTransition(s, s)).toBe(true);
    }
  });

  it("allows draft → submitted (tutor submit)", () => {
    expect(isValidStatusTransition("draft", "submitted")).toBe(true);
  });

  it("allows draft → frozen (admin force-freeze a draft)", () => {
    expect(isValidStatusTransition("draft", "frozen")).toBe(true);
  });

  it("allows submitted → draft (tutor revert before deadline)", () => {
    expect(isValidStatusTransition("submitted", "draft")).toBe(true);
  });

  it("allows submitted → frozen (admin force-freeze a submitted)", () => {
    expect(isValidStatusTransition("submitted", "frozen")).toBe(true);
  });

  it("allows frozen → draft (admin unfreeze back to draft)", () => {
    expect(isValidStatusTransition("frozen", "draft")).toBe(true);
  });

  it("rejects frozen → submitted (admin must route via draft + tutor re-submit)", () => {
    expect(isValidStatusTransition("frozen", "submitted")).toBe(false);
  });

  it("matrix is exhaustive: 9 pairs covered exactly", () => {
    const results: Array<{ from: string; to: string; ok: boolean }> = [];
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        results.push({ from, to, ok: isValidStatusTransition(from, to) });
      }
    }
    expect(results).toHaveLength(9);
    // 8 許可 (3 noop + 5 valid transitions), 1 拒否 (frozen→submitted)
    expect(results.filter((r) => r.ok).length).toBe(8);
    expect(results.filter((r) => !r.ok)).toEqual([
      { from: "frozen", to: "submitted", ok: false },
    ]);
  });
});

describe("classifyTransition", () => {
  it("classifies each valid transition with a stable label", () => {
    expect(classifyTransition("draft", "draft")).toBe("noop");
    expect(classifyTransition("submitted", "submitted")).toBe("noop");
    expect(classifyTransition("frozen", "frozen")).toBe("noop");

    expect(classifyTransition("draft", "submitted")).toBe("submit");
    expect(classifyTransition("submitted", "draft")).toBe("revert");

    expect(classifyTransition("draft", "frozen")).toBe("admin_freeze");
    expect(classifyTransition("submitted", "frozen")).toBe("admin_freeze");

    expect(classifyTransition("frozen", "draft")).toBe("admin_unfreeze");
  });

  it("returns 'invalid' for frozen → submitted", () => {
    expect(classifyTransition("frozen", "submitted")).toBe("invalid");
  });
});
