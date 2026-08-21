import { describe, expect, it } from "vitest";
import {
  planSwapReapplication,
  type ApprovedSwap,
  type InsertedShift,
} from "@/lib/swap-reapplication";

const at = (iso: string) => new Date(iso);
const shift = (tutorId: string): InsertedShift => ({
  tutorId,
  date: "2026-09-04",
  slotNumber: 3,
});
const swap = (
  id: string,
  requesterId: string,
  applicantId: string,
  decidedAt: Date | null,
): ApprovedSwap => ({
  id,
  requesterId,
  applicantId,
  date: "2026-09-04",
  slotNumber: 3,
  decidedAt,
});

describe("planSwapReapplication", () => {
  it("承認済みの付け替えを復元する", () => {
    const plan = planSwapReapplication(
      [shift("A"), shift("X")],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([
      {
        swapId: "s1",
        date: "2026-09-04",
        slotNumber: 3,
        fromTutorId: "A",
        toTutorId: "B",
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  // ⚠️ この 2 件が実装の理由。A→B の後に B が同じコマで再募集して B→C も
  // 承認されうる (swap_requests_active_uniq は requester 違いなので効かない)。
  // 順序を間違えると「実際は C なのに B が確定する」が、DB のヒープ順次第で
  // **再現性なく**起きる。
  it("連鎖 (A→B → B→C) を承認順に積む", () => {
    const plan = planSwapReapplication(
      [shift("A")],
      [
        swap("s1", "A", "B", at("2026-09-01T00:00:00Z")),
        swap("s2", "B", "C", at("2026-09-02T00:00:00Z")),
      ],
    );

    expect(plan.applies.map((a) => [a.fromTutorId, a.toTutorId])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("承認順が逆に渡ってきても結果は同じ (最終的に C)", () => {
    const plan = planSwapReapplication(
      [shift("A")],
      [
        swap("s2", "B", "C", at("2026-09-02T00:00:00Z")),
        swap("s1", "A", "B", at("2026-09-01T00:00:00Z")),
      ],
    );

    expect(plan.applies.at(-1)?.toTutorId).toBe("C");
    expect(plan.skipped).toEqual([]);
  });

  // ⚠️ 代講者が既にそのコマに居ると、付け替えが
  // weekly_shifts_unique (upload_id, tutor_id, date, slot_number) に衝突して
  // **取り込みが丸ごとロールバックする**。例外にせず警告へ落とす。
  it("代講者が既にそのコマに居るなら適用しない (一意制約の衝突を避ける)", () => {
    const plan = planSwapReapplication(
      [shift("A"), shift("B")],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        swapId: "s1",
        date: "2026-09-04",
        slotNumber: 3,
        reason: "applicant-conflict",
      },
    ]);
  });

  it("新しい CSV に元の講師が居なければ復元しない", () => {
    const plan = planSwapReapplication(
      [shift("X")],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("requester-absent");
  });

  it("そのコマが CSV に無い (休講など) なら復元しない", () => {
    const plan = planSwapReapplication(
      [],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("requester-absent");
  });

  it("別の日・別のコマを混ぜない", () => {
    const plan = planSwapReapplication(
      [{ tutorId: "A", date: "2026-09-05", slotNumber: 3 }],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("requester-absent");
  });

  it("decidedAt が無くても落ちない", () => {
    // 旧データや手動投入。順序は決まらないが、少なくとも例外にはしない。
    const plan = planSwapReapplication([shift("A")], [swap("s1", "A", "B", null)]);

    expect(plan.applies).toHaveLength(1);
  });
});
