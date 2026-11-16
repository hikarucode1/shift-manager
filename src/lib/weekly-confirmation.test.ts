import { describe, expect, it } from "vitest";
import {
  changedTutorWeeks,
  confirmationSummary,
  type SlotCell,
} from "./weekly-confirmation";

const c = (tutorId: string, date: string, slotNumber: number): SlotCell => ({
  tutorId,
  date,
  slotNumber,
});

describe("changedTutorWeeks (#317)", () => {
  it("コマが同じ講師は変わっていない (並び順は関係ない)", () => {
    expect(
      changedTutorWeeks(
        [c("A", "2026-11-16", 1), c("A", "2026-11-18", 3)],
        [c("A", "2026-11-18", 3), c("A", "2026-11-16", 1)],
      ),
    ).toEqual([]);
  });
  it("コマが動いた・増えた・減った講師だけを返す", () => {
    expect(
      changedTutorWeeks(
        [c("A", "2026-11-16", 1), c("B", "2026-11-16", 2), c("C", "2026-11-17", 1)],
        [c("A", "2026-11-16", 2), c("B", "2026-11-16", 2), c("B", "2026-11-17", 4)],
      ).sort((x, y) => x.tutorId.localeCompare(y.tutorId)),
    ).toEqual([
      { tutorId: "A", weekStart: "2026-11-16" },
      { tutorId: "B", weekStart: "2026-11-16" },
      { tutorId: "C", weekStart: "2026-11-16" },
    ]);
  });
  it("週ごとに見る (別の週の変更は別の組)", () => {
    expect(
      changedTutorWeeks(
        [c("A", "2026-11-16", 1), c("A", "2026-11-23", 1)],
        [c("A", "2026-11-16", 1), c("A", "2026-11-23", 2)],
      ),
    ).toEqual([{ tutorId: "A", weekStart: "2026-11-23" }]);
  });
  it("日曜は月曜始まりの週に入る", () => {
    expect(changedTutorWeeks([], [c("A", "2026-11-22", 1)])).toEqual([
      { tutorId: "A", weekStart: "2026-11-16" },
    ]);
  });
});

describe("confirmationSummary (#317)", () => {
  it("その週にコマがある講師だけを数え、未確認の名前を返す", () => {
    expect(
      confirmationSummary(
        [
          { id: "A", name: "山田" },
          { id: "B", name: "佐藤" },
        ],
        new Set(["A", "Z"]),
      ),
    ).toEqual({ confirmed: 1, total: 2, unconfirmedNames: ["佐藤"] });
  });
});
