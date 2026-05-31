import { describe, it, expect } from "vitest";
import {
  lastDayOfMonth,
  monthsInPeriod,
  nextDay,
  prevDay,
  splitRangeRemovingMonth,
} from "./shift-period";

describe("prevDay / nextDay", () => {
  it("prevDay subtracts one calendar day across month boundary", () => {
    expect(prevDay("2026-05-01")).toBe("2026-04-30");
    expect(prevDay("2026-03-01")).toBe("2026-02-28");
    expect(prevDay("2024-03-01")).toBe("2024-02-29");
    expect(prevDay("2027-01-01")).toBe("2026-12-31");
  });

  it("nextDay adds one calendar day across month boundary", () => {
    expect(nextDay("2026-04-30")).toBe("2026-05-01");
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
    expect(nextDay("2024-02-29")).toBe("2024-03-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("splitRangeRemovingMonth", () => {
  const targetStart = "2026-05-01";
  const targetEnd = "2026-05-31";

  it("splits a term-wide range into two when the month sits inside", () => {
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([
      { effectiveFrom: "2026-04-01", effectiveTo: "2026-04-30" },
      { effectiveFrom: "2026-06-01", effectiveTo: "2026-06-30" },
    ]);
  });

  it("trims to the left when the range ends inside the month", () => {
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-04-01", effectiveTo: "2026-05-15" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([{ effectiveFrom: "2026-04-01", effectiveTo: "2026-04-30" }]);
  });

  it("trims to the right when the range starts inside the month", () => {
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-05-15", effectiveTo: "2026-06-30" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([{ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-30" }]);
  });

  it("returns empty when the range sits fully inside the month", () => {
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-05-10", effectiveTo: "2026-05-20" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([]);
  });

  it("returns the original range when it is entirely before the month", () => {
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-03-01", effectiveTo: "2026-03-31" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([{ effectiveFrom: "2026-03-01", effectiveTo: "2026-03-31" }]);
  });

  it("returns the original range when it is entirely after the month", () => {
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-07-01", effectiveTo: "2026-07-31" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([{ effectiveFrom: "2026-07-01", effectiveTo: "2026-07-31" }]);
  });

  it("treats a range that ends exactly on monthStart as overlapping (touching counts)", () => {
    // existing: ...4/1 - 5/1, removing May → 残り (4/1 - 4/30)
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-04-01", effectiveTo: "2026-05-01" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([{ effectiveFrom: "2026-04-01", effectiveTo: "2026-04-30" }]);
  });

  it("treats a range that starts exactly on monthEnd as overlapping", () => {
    expect(
      splitRangeRemovingMonth(
        { effectiveFrom: "2026-05-31", effectiveTo: "2026-06-30" },
        targetStart,
        targetEnd,
      ),
    ).toEqual([{ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-30" }]);
  });
});

describe("lastDayOfMonth", () => {
  it("returns the 30th for April (30-day month)", () => {
    expect(lastDayOfMonth("2026-04-01")).toBe("2026-04-30");
  });

  it("returns the 31st for July (31-day month)", () => {
    expect(lastDayOfMonth("2026-07-01")).toBe("2026-07-31");
  });

  it("returns the 28th for February in a non-leap year", () => {
    expect(lastDayOfMonth("2026-02-01")).toBe("2026-02-28");
  });

  it("returns the 29th for February in a leap year", () => {
    expect(lastDayOfMonth("2024-02-01")).toBe("2024-02-29");
  });

  it("returns the 31st for December (year boundary)", () => {
    expect(lastDayOfMonth("2026-12-01")).toBe("2026-12-31");
  });

  it("returns empty string for malformed input", () => {
    expect(lastDayOfMonth("2026-04-15")).toBe("");
    expect(lastDayOfMonth("invalid")).toBe("");
    expect(lastDayOfMonth("")).toBe("");
  });
});

describe("monthsInPeriod", () => {
  it("returns a single month when start and end are within the same month", () => {
    expect(monthsInPeriod("2026-04-01", "2026-04-30")).toEqual([
      "2026-04-01",
    ]);
  });

  it("expands a 3-month spring term to three month-firsts", () => {
    expect(monthsInPeriod("2026-04-01", "2026-06-30")).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });

  it("includes the start month even when the period starts mid-month", () => {
    expect(monthsInPeriod("2026-04-16", "2026-06-30")).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });

  it("includes the end month even when the period ends mid-month", () => {
    expect(monthsInPeriod("2026-04-01", "2026-06-15")).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });

  it("crosses the year boundary correctly", () => {
    expect(monthsInPeriod("2026-12-15", "2027-02-10")).toEqual([
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]);
  });

  it("returns an empty list when end < start", () => {
    expect(monthsInPeriod("2026-06-01", "2026-04-30")).toEqual([]);
  });

  it("returns an empty list for malformed input", () => {
    expect(monthsInPeriod("invalid", "2026-04-01")).toEqual([]);
    expect(monthsInPeriod("2026-04-01", "")).toEqual([]);
  });

  it("handles same-day start and end", () => {
    expect(monthsInPeriod("2026-04-15", "2026-04-15")).toEqual(["2026-04-01"]);
  });
});
