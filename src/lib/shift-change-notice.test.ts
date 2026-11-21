import { describe, expect, it } from "vitest";
import {
  shiftChangeBody,
  shiftChangesByTutor,
  type ShiftCell,
} from "./shift-change-notice";

const c = (
  tutorId: string,
  date: string,
  slotNumber: number,
  filled = true,
): ShiftCell => ({ tutorId, date, slotNumber, filled });

describe("shiftChangesByTutor", () => {
  it("変わっていない講師は入らない", () => {
    const cells = [c("t1", "2026-12-03", 5)];
    expect(shiftChangesByTutor(cells, cells).size).toBe(0);
  });

  it("未定のコマに授業が入ったら filled", () => {
    const m = shiftChangesByTutor(
      [c("t1", "2026-12-03", 5, false)],
      [c("t1", "2026-12-03", 5, true)],
    );
    expect(m.get("t1")).toEqual([
      { kind: "filled", date: "2026-12-03", slotNumber: 5 },
    ]);
  });

  it("授業が無くなって未定になったら emptied", () => {
    const m = shiftChangesByTutor(
      [c("t1", "2026-12-03", 5, true)],
      [c("t1", "2026-12-03", 5, false)],
    );
    expect(m.get("t1")?.[0].kind).toBe("emptied");
  });

  it("コマの追加・削除を日付と何限の順で並べる", () => {
    const m = shiftChangesByTutor(
      [c("t1", "2026-12-05", 2), c("t1", "2026-12-03", 5)],
      [c("t1", "2026-12-03", 5), c("t1", "2026-12-04", 3)],
    );
    expect(m.get("t1")).toEqual([
      { kind: "added", date: "2026-12-04", slotNumber: 3 },
      { kind: "removed", date: "2026-12-05", slotNumber: 2 },
    ]);
  });

  it("担当の講師が入れ替わったら、両方に届く", () => {
    const m = shiftChangesByTutor(
      [c("t1", "2026-12-03", 5)],
      [c("t2", "2026-12-03", 5)],
    );
    expect(m.get("t1")?.[0].kind).toBe("removed");
    expect(m.get("t2")?.[0].kind).toBe("added");
  });
});

describe("shiftChangeBody", () => {
  const label = (n: number) => `${n}限`;

  it("種類・日付・何限を並べる", () => {
    expect(
      shiftChangeBody(
        [
          { kind: "filled", date: "2026-12-03", slotNumber: 5 },
          { kind: "added", date: "2026-12-04", slotNumber: 3 },
          { kind: "removed", date: "2026-12-05", slotNumber: 2 },
        ],
        label,
      ),
    ).toBe(
      "授業が入った 12/3（木）5限、追加 12/4（金）3限、なし 12/5（土）2限",
    );
  });

  it("多いときは「ほか N コマ」にまとめる", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      kind: "added" as const,
      date: "2026-12-03",
      slotNumber: i + 1,
    }));
    expect(shiftChangeBody(many, label)).toMatch(/、ほか 2 コマ$/);
  });
});
