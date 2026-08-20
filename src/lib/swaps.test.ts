import { describe, expect, it } from "vitest";
import { busySlotKey, groupBusyBySlot } from "@/lib/swaps";

describe("groupBusyBySlot", () => {
  it("コマごとに講師 id をまとめる", () => {
    const busy = groupBusyBySlot([
      { date: "2026-02-14", slotNumber: 3, tutorId: "t1" },
      { date: "2026-02-14", slotNumber: 3, tutorId: "t2" },
      { date: "2026-02-14", slotNumber: 4, tutorId: "t1" },
    ]);

    expect(busy).toEqual({
      "2026-02-14|3": ["t1", "t2"],
      "2026-02-14|4": ["t1"],
    });
  });

  it("別の日の同じコマ番号を混ぜない", () => {
    // 混ざると「別の日に出勤しているだけの講師」を指名できなくなる。
    const busy = groupBusyBySlot([
      { date: "2026-02-14", slotNumber: 3, tutorId: "t1" },
      { date: "2026-02-15", slotNumber: 3, tutorId: "t2" },
    ]);

    expect(busy["2026-02-14|3"]).toEqual(["t1"]);
    expect(busy["2026-02-15|3"]).toEqual(["t2"]);
  });

  it("空なら空", () => {
    expect(groupBusyBySlot([])).toEqual({});
  });

  it("キーは UI 側の 'date|slot' 形式と一致する", () => {
    // SwapPanel の target ("date|slotNumber") をそのままキーに使うので、
    // ここがずれると全員が候補に残り、#181 の対処が黙って無効になる。
    expect(busySlotKey("2026-02-14", 3)).toBe("2026-02-14|3");
  });
});
