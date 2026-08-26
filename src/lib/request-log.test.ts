import { describe, expect, it } from "vitest";
import {
  mergeLogEntries,
  toAbsenceLogEntry,
  toSwapLogEntry,
  type AbsenceLogInput,
  type RequestLogEntry,
  type SwapLogInput,
} from "@/lib/request-log";

const common = {
  id: "id-1",
  date: "2026-08-20",
  slotNumber: 3,
  slotLabel: "3限",
  weekdayLabel: "木",
  reason: "発熱のため",
  note: null,
  actorName: null,
  decidedAt: null,
  updatedAt: "2026-08-21T00:00:00.000Z",
};

const absence = (o: Partial<AbsenceLogInput> = {}): AbsenceLogInput => ({
  ...common,
  status: "approved",
  tutorName: "山田",
  isProxy: false,
  autoExpired: false,
  ...o,
});

const swap = (o: Partial<SwapLogInput> = {}): SwapLogInput => ({
  ...common,
  status: "approved",
  requesterName: "山田",
  approvedApplicantName: "佐藤",
  isRecorded: false,
  ...o,
});

describe("toAbsenceLogEntry", () => {
  it("講師の申請を承認した行は approved", () => {
    const e = toAbsenceLogEntry(absence());
    expect(e.event).toBe("approved");
    expect(e.eventLabel).toBe("承認");
  });

  it("代理登録 (#217) は approved と区別する", () => {
    // pending を経由しないので「承認」と出すと、誰も判断していない
    // 手続きを主張することになる
    const e = toAbsenceLogEntry(absence({ isProxy: true }));
    expect(e.event).toBe("registered");
    expect(e.eventLabel).toBe("代理登録");
  });

  it("自動失効は、教室長の取り消しと区別する (#225)", () => {
    // #225 以降は自動失効も decided_at を書くので、時刻の有無では区別できない。
    // actorName より先に autoExpired を見ていることの確認
    const e = toAbsenceLogEntry(
      absence({
        status: "cancelled",
        autoExpired: true,
        actorName: "教室長A",
        decidedAt: "2026-08-25T12:30:00.000Z",
      }),
    );
    expect(e.event).toBe("auto-expired");
  });

  it("教室長の取り消しと講師の自己取り下げを分ける", () => {
    expect(
      toAbsenceLogEntry(
        absence({ status: "cancelled", actorName: "教室長A" }),
      ).event,
    ).toBe("cancelled-by-admin");
    expect(
      toAbsenceLogEntry(absence({ status: "cancelled", actorName: null })).event,
    ).toBe("cancelled-by-tutor");
  });

  it("却下と未対応", () => {
    expect(toAbsenceLogEntry(absence({ status: "rejected" })).event).toBe(
      "rejected",
    );
    expect(toAbsenceLogEntry(absence({ status: "pending" })).event).toBe(
      "pending",
    );
  });

  it("欠勤に代講者は無いので substituteName は常に null", () => {
    expect(toAbsenceLogEntry(absence()).substituteName).toBeNull();
  });

  it("cancellable は approved のときだけ", () => {
    expect(toAbsenceLogEntry(absence({ status: "approved" })).cancellable).toBe(
      true,
    );
    expect(toAbsenceLogEntry(absence({ status: "cancelled" })).cancellable).toBe(
      false,
    );
    expect(toAbsenceLogEntry(absence({ status: "rejected" })).cancellable).toBe(
      false,
    );
  });
});

describe("toSwapLogEntry", () => {
  it("承認と記録 (#215) を区別する", () => {
    expect(toSwapLogEntry(swap()).event).toBe("approved");
    const rec = toSwapLogEntry(swap({ isRecorded: true }));
    expect(rec.event).toBe("recorded");
    expect(rec.eventLabel).toBe("記録");
  });

  it("承認済みの取り消しと、承認前の取り下げ (#231) を分ける", () => {
    // 代講者が決まっていたかで区別する
    expect(
      toSwapLogEntry(
        swap({
          status: "cancelled",
          actorName: "教室長A",
          approvedApplicantName: "佐藤",
        }),
      ).event,
    ).toBe("cancelled-by-admin");
    expect(
      toSwapLogEntry(
        swap({
          status: "cancelled",
          actorName: "教室長A",
          approvedApplicantName: null,
        }),
      ).event,
    ).toBe("withdrawn-by-admin");
  });

  it("承認前に閉じた行の substituteName は null のまま (#240)", () => {
    // ここを「不明」と出すと「代講者が分からなくなった取り消し」に見える
    const e = toSwapLogEntry(
      swap({
        status: "cancelled",
        actorName: "教室長A",
        approvedApplicantName: null,
      }),
    );
    expect(e.substituteName).toBeNull();
  });

  it("講師の自己取り下げは actorName が無いことで判る", () => {
    expect(
      toSwapLogEntry(
        swap({
          status: "cancelled",
          actorName: null,
          approvedApplicantName: null,
        }),
      ).event,
    ).toBe("cancelled-by-tutor");
  });
});

describe("occurredAt", () => {
  it("decided_at があればそれ、無ければ updated_at (#233)", () => {
    expect(
      toAbsenceLogEntry(absence({ decidedAt: "2026-08-26T05:00:00.000Z" }))
        .occurredAt,
    ).toBe("2026-08-26T05:00:00.000Z");
    // 講師の自己取り下げは decided_at を書かない
    expect(toAbsenceLogEntry(absence({ decidedAt: null })).occurredAt).toBe(
      "2026-08-21T00:00:00.000Z",
    );
  });
});

describe("mergeLogEntries", () => {
  const at = (id: string, iso: string): RequestLogEntry =>
    toAbsenceLogEntry(absence({ id, decidedAt: iso }));

  it("決定が新しい順に混ぜる", () => {
    const merged = mergeLogEntries(
      [at("a", "2026-08-20T00:00:00.000Z"), at("b", "2026-08-24T00:00:00.000Z")],
      [at("c", "2026-08-22T00:00:00.000Z")],
      10,
    );
    expect(merged.rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(merged.truncated).toBe(false);
  });

  it("limit で切り、まだ先があれば truncated", () => {
    const merged = mergeLogEntries(
      [at("a", "2026-08-20T00:00:00.000Z"), at("b", "2026-08-24T00:00:00.000Z")],
      [at("c", "2026-08-22T00:00:00.000Z")],
      2,
    );
    expect(merged.rows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(merged.truncated).toBe(true);
  });

  it("同時刻は id で安定させる (ページングの前提)", () => {
    const same = "2026-08-24T00:00:00.000Z";
    expect(
      mergeLogEntries([at("b", same)], [at("a", same)], 10).rows.map(
        (r) => r.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("片方が空でも動く", () => {
    expect(mergeLogEntries([], [at("a", "2026-08-20T00:00:00.000Z")], 10).rows)
      .toHaveLength(1);
    expect(mergeLogEntries([], [], 10)).toEqual({ rows: [], truncated: false });
  });
});
