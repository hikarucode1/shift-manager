import { describe, expect, it } from "vitest";
import {
  dayOffCovers,
  dayOffSlotsLabel,
  findDayOffConflicts,
  normalizeSlotNumbers,
} from "./day-off-rule";

describe("dayOffSlotsLabel", () => {
  it("空なら終日", () => {
    expect(dayOffSlotsLabel([])).toBe("終日");
  });
  it("コマは昇順で並べる", () => {
    expect(dayOffSlotsLabel([3, 1])).toBe("1限・3限");
  });
});

describe("dayOffCovers", () => {
  it("終日はどのコマも含む", () => {
    expect(dayOffCovers([], 4)).toBe(true);
  });
  it("指定したコマだけ含む", () => {
    expect(dayOffCovers([2, 3], 3)).toBe(true);
    expect(dayOffCovers([2, 3], 1)).toBe(false);
  });
});

describe("findDayOffConflicts", () => {
  const dayOffs = [
    { tutorId: "a", date: "2026-12-04", slotNumbers: [] },
    { tutorId: "b", date: "2026-12-04", slotNumbers: [2] },
  ];
  it("同じ講師・同じ日で、休みのコマに入っているシフトだけ拾う", () => {
    const shifts = [
      { tutorId: "a", date: "2026-12-04", slotNumber: 1 },
      { tutorId: "a", date: "2026-12-05", slotNumber: 1 },
      { tutorId: "b", date: "2026-12-04", slotNumber: 1 },
      { tutorId: "b", date: "2026-12-04", slotNumber: 2 },
      { tutorId: "c", date: "2026-12-04", slotNumber: 2 },
    ];
    expect(findDayOffConflicts(dayOffs, shifts)).toEqual([
      shifts[0],
      shifts[3],
    ]);
  });
});

describe("normalizeSlotNumbers", () => {
  it("重複を除いて昇順にする", () => {
    expect(normalizeSlotNumbers([3, 1, 3])).toEqual([1, 3]);
  });
});
