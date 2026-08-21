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
  createdAt = at("2026-08-01T00:00:00Z"),
): ApprovedSwap => ({
  id,
  requesterId,
  applicantId,
  date: "2026-09-04",
  slotNumber: 3,
  decidedAt,
  createdAt,
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
        matchTutorId: "A",
        setTutorId: "B",
        noteFromId: "A",
        noteToId: "B",
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

    expect(plan.applies.map((a) => [a.matchTutorId, a.setTutorId])).toEqual([
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

    expect(plan.applies.at(-1)?.setTutorId).toBe("C");
    expect(plan.skipped).toEqual([]);
  });

  // ⚠️ 代講者が既にそのコマに居ると、付け替えが
  // weekly_shifts_unique (upload_id, tutor_id, date, slot_number) に衝突して
  // **取り込みが丸ごとロールバックする**。例外にせず警告へ落とす。
  it("元の講師と代講者が両方居るなら付け替えない (一意制約の衝突を避ける)", () => {
    // 付け替えると weekly_shifts_unique に衝突して取り込みが丸ごと落ちる。
    const plan = planSwapReapplication(
      [shift("A"), shift("B")],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("applicant-conflict");
  });

  // ⚠️ CSV が既に代講を反映しているのは**正常**。ここを requester-absent と
  // 一緒くたにすると「食い違うので確認してください」と赤で出る偽陽性になり、
  // 警告が無視される訓練になる (レビュー指摘)。
  it("CSV が既に代講を反映しているなら、痕跡だけ付け直す", () => {
    const plan = planSwapReapplication(
      [shift("B")],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([
      {
        swapId: "s1",
        date: "2026-09-04",
        slotNumber: 3,
        matchTutorId: "B",
        setTutorId: "B",
        noteFromId: "A",
        noteToId: "B",
      },
    ]);
    expect(plan.skipped[0]?.reason).toBe("already-reflected");
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

  // ⚠️ 以下 3 件は、レビューのミューテーションで**すり抜けた**変異を殺すためのもの。
  // 実装を壊しても既存 8 件が全部緑のままだった箇所。

  it("先に適用した swap の requester が、後の swap の代講者になれる", () => {
    // コマに A と C。A→B が承認されて A が空き、その A が C の代講に入る。
    // 在席マップから requester を delete していないと、C→A が
    // 「代講者が既に居る」と誤判定されて復元されない (実際に起きる経路)。
    const plan = planSwapReapplication(
      [shift("A"), shift("C")],
      [
        swap("s1", "A", "B", at("2026-09-01T00:00:00Z")),
        swap("s2", "C", "A", at("2026-09-02T00:00:00Z")),
      ],
    );

    expect(plan.skipped).toEqual([]);
    expect(plan.applies.map((a) => [a.matchTutorId, a.setTutorId])).toEqual([
      ["A", "B"],
      ["C", "A"],
    ]);
  });

  it("同じ日の別のコマを混ぜない", () => {
    // キーから slotNumber を落としても既存テストは全部通ってしまっていた。
    const plan = planSwapReapplication(
      [{ tutorId: "A", date: "2026-09-04", slotNumber: 5 }],
      [swap("s1", "A", "B", at("2026-09-01T00:00:00Z"))],
    );

    expect(plan.applies).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("requester-absent");
  });

  it("decidedAt が同値でも順序が決まる (連鎖が壊れない)", () => {
    // Array#sort は安定なので、同値だと入力順 = DB のヒープ順に落ちる。
    // 第 2・第 3 キーが無いと「実際は C なのに B が確定する」が復活する。
    const same = at("2026-09-01T00:00:00Z");
    const plan = planSwapReapplication(
      [shift("A")],
      [
        swap("s2", "B", "C", same, at("2026-08-02T00:00:00Z")),
        swap("s1", "A", "B", same, at("2026-08-01T00:00:00Z")),
      ],
    );

    expect(plan.skipped).toEqual([]);
    expect(plan.applies.at(-1)?.setTutorId).toBe("C");
  });

  it("decidedAt が無くても落ちない", () => {
    // 旧データや手動投入。順序は決まらないが、少なくとも例外にはしない。
    const plan = planSwapReapplication([shift("A")], [swap("s1", "A", "B", null)]);

    expect(plan.applies).toHaveLength(1);
  });
});
