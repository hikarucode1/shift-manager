import { describe, expect, it } from "vitest";
import { pickUsualRegularSlots } from "./usual-regular";

const row = (weekday: string, slotNumber: number, effectiveFrom: string, effectiveTo: string) => ({
  weekday,
  slotNumber,
  effectiveFrom,
  effectiveTo,
});

describe("pickUsualRegularSlots", () => {
  it("レギュラーが無ければ空", () => {
    expect(pickUsualRegularSlots([], "2027-01-07")).toEqual([]);
  });

  it("講習の前に終わった期でも、直前の期を普段とみなす", () => {
    const rows = [
      row("mon", 3, "2026-05-01", "2026-06-30"),
      row("tue", 4, "2026-10-01", "2026-11-30"),
      row("fri", 5, "2026-10-01", "2026-11-30"),
    ];
    expect(pickUsualRegularSlots(rows, "2027-01-07")).toEqual(["fri|5", "tue|4"]);
  });

  it("期の途中で変えたときは、最後に効いている行だけ", () => {
    const rows = [
      row("tue", 4, "2026-10-01", "2026-10-31"),
      row("wed", 4, "2026-11-01", "2026-11-30"),
    ];
    expect(pickUsualRegularSlots(rows, "2027-01-07")).toEqual(["wed|4"]);
  });

  it("講習期間の後に始まる期は使わない", () => {
    const rows = [
      row("mon", 3, "2026-05-01", "2026-06-30"),
      row("thu", 2, "2027-05-01", "2027-06-30"),
    ];
    expect(pickUsualRegularSlots(rows, "2026-08-31")).toEqual(["mon|3"]);
  });

  it("講習期間がレギュラーの期の中にあるときは、講習の終わりの日に効いている行", () => {
    const rows = [
      row("mon", 3, "2026-10-01", "2026-10-15"),
      row("sat", 1, "2026-10-16", "2026-11-30"),
    ];
    expect(pickUsualRegularSlots(rows, "2026-10-20")).toEqual(["sat|1"]);
  });
});
