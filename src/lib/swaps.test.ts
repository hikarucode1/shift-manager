import { describe, expect, it } from "vitest";
import { getBusyTutorIdsBySlot, groupBusyBySlot } from "@/lib/swaps";
import { busySlotKey } from "@/lib/slot-key";

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

  it("キーは busySlotKey で作る (サーバーとクライアントで同じ関数)", () => {
    // SwapPanel の target も同じ busySlotKey で作る。別々にリテラルを
    // 手書きしていると、片方だけ変えても型は通り、busyBySlot[target] が
    // 常に undefined になって #181 の対処が黙って無効になる。
    const busy = groupBusyBySlot([
      { date: "2026-02-14", slotNumber: 3, tutorId: "t1" },
    ]);

    expect(busy[busySlotKey("2026-02-14", 3)]).toEqual(["t1"]);
  });
});

describe("getBusyTutorIdsBySlot", () => {
  it("コマが 0 件なら DB を引かずに空を返す", async () => {
    // ⚠️ この早期 return は load-bearing。drizzle の or() は条件 0 件で
    // undefined を返し .where(undefined) は WHERE 句ごと落ちるので、消すと
    // weekly_shifts 全件を引いて全講師が disable される。DB 接続の無い
    // この環境でも通る = クエリに到達していないこと自体の証明になる。
    await expect(getBusyTutorIdsBySlot([])).resolves.toEqual({});
  });
});
