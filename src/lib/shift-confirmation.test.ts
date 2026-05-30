import { describe, it, expect } from "vitest";
import {
  assignmentKey,
  dedupeAssignments,
  diffAssignments,
} from "./shift-confirmation";

describe("assignmentKey", () => {
  it("builds a stable string key from PK fields", () => {
    expect(
      assignmentKey({ tutorId: "abc", weekday: "mon", slotNumber: 6 }),
    ).toBe("abc:mon:6");
  });
});

describe("dedupeAssignments", () => {
  it("returns input unchanged when no duplicates", () => {
    const input = [
      { tutorId: "a", weekday: "mon", slotNumber: 1 },
      { tutorId: "a", weekday: "mon", slotNumber: 2 },
      { tutorId: "b", weekday: "mon", slotNumber: 1 },
    ];
    expect(dedupeAssignments(input)).toEqual(input);
  });

  it("keeps first occurrence and drops subsequent duplicates", () => {
    const input = [
      { tutorId: "a", weekday: "mon", slotNumber: 1, marker: "first" },
      { tutorId: "a", weekday: "mon", slotNumber: 1, marker: "second" },
      { tutorId: "a", weekday: "mon", slotNumber: 2, marker: "kept" },
    ];
    const result = dedupeAssignments(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(input[0]);
    expect(result[1]).toEqual(input[2]);
  });

  it("handles empty input", () => {
    expect(dedupeAssignments([])).toEqual([]);
  });
});

describe("diffAssignments", () => {
  it("returns empty diff when sets are identical (order ignored)", () => {
    const prev = [
      { tutorId: "a", weekday: "mon", slotNumber: 1 },
      { tutorId: "b", weekday: "tue", slotNumber: 3 },
    ];
    const next = [
      { tutorId: "b", weekday: "tue", slotNumber: 3 },
      { tutorId: "a", weekday: "mon", slotNumber: 1 },
    ];
    const { added, removed } = diffAssignments(prev, next);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("classifies adds and removes correctly", () => {
    const prev = [
      { tutorId: "a", weekday: "mon", slotNumber: 1 },
      { tutorId: "a", weekday: "tue", slotNumber: 2 },
    ];
    const next = [
      { tutorId: "a", weekday: "mon", slotNumber: 1 }, // 維持
      { tutorId: "b", weekday: "wed", slotNumber: 5 }, // 追加
    ];
    const { added, removed } = diffAssignments(prev, next);
    expect(added).toEqual([{ tutorId: "b", weekday: "wed", slotNumber: 5 }]);
    expect(removed).toEqual([{ tutorId: "a", weekday: "tue", slotNumber: 2 }]);
  });

  it("returns full prev as removed when next is empty (清算ケース)", () => {
    const prev = [{ tutorId: "a", weekday: "mon", slotNumber: 1 }];
    const { added, removed } = diffAssignments(prev, []);
    expect(added).toEqual([]);
    expect(removed).toEqual(prev);
  });

  it("returns full next as added when prev is empty (初回確定)", () => {
    const next = [{ tutorId: "a", weekday: "mon", slotNumber: 1 }];
    const { added, removed } = diffAssignments([], next);
    expect(added).toEqual(next);
    expect(removed).toEqual([]);
  });
});
