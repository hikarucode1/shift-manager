import { describe, expect, it } from "vitest";
import {
  EVENT_LABEL,
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
  isProxy: false,
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

  it("自動失効は、講師の自己取り下げと区別する (#225)", () => {
    // 実データの形: 自動失効は decided_by を明示的に null にし、decided_at は
    // 書く。actorName より先に autoExpired を見ていないと「講師が取り下げ」に
    // 落ちる
    const e = toAbsenceLogEntry(
      absence({
        status: "cancelled",
        autoExpired: true,
        actorName: null,
        decidedAt: "2026-08-25T12:30:00.000Z",
      }),
    );
    expect(e.event).toBe("auto-expired");
    expect(e.eventLabel).toBe("失効（交代成立による）");
  });

  it("教室長が取り消し理由に同じ文言を書いても失効に化けない", () => {
    // decision_note は自由文なので、アプリ外で代講を手配した教室長が
    // 「交代成立により自動失効」と書きうる。自動失効は必ず decided_by が
    // null なので、AND で縛って構造的に区別する
    const e = toAbsenceLogEntry(
      absence({ status: "cancelled", autoExpired: true, actorName: "教室長A" }),
    );
    expect(e.event).toBe("cancelled-by-admin");
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

  it("承認済みの行は代講者の名前が出る", () => {
    expect(toSwapLogEntry(swap()).substituteName).toBe("佐藤");
    expect(toSwapLogEntry(swap({ isRecorded: true })).substituteName).toBe("佐藤");
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

describe("フィールドの受け渡し", () => {
  it("素通しの列が入れ替わっていないこと (1 例で全フィールドを固定)", () => {
    // subjectName / actorName / reason / note / slotLabel などは加工せず
    // 渡すだけなので個別テストだと漏れる。1 例だけ丸ごと固定する
    expect(
      toSwapLogEntry(
        swap({
          id: "sw-1",
          status: "cancelled",
          actorName: "教室長A",
          approvedApplicantName: "佐藤",
          note: "実際には代講が入らなかったため",
          decidedAt: "2026-08-26T05:00:00.000Z",
        }),
      ),
    ).toEqual({
      id: "sw-1",
      kind: "swap",
      event: "cancelled-by-admin",
      occurredAt: "2026-08-26T05:00:00.000Z",
      date: "2026-08-20",
      slotNumber: 3,
      slotLabel: "3限",
      weekdayLabel: "木",
      subjectName: "山田",
      substituteName: "佐藤",
      actorName: "教室長A",
      reason: "発熱のため",
      note: "実際には代講が入らなかったため",
      eventLabel: "取り消し",
      adminInitiated: false,
      cancellable: false,
    });
  });
});

describe("adminInitiated", () => {
  it("欠勤: 代理登録で立つ (#217)", () => {
    expect(toAbsenceLogEntry(absence({ isProxy: true })).adminInitiated).toBe(true);
    expect(toAbsenceLogEntry(absence()).adminInitiated).toBe(false);
  });

  it("交代: 代理募集が承認されても「教室長が起点」は消えない (#227)", () => {
    // event は approved で正しい (pending を経て普通に承認されている)。
    // 「山田が頼んだのか教室長が出したのか」は別の軸で残す
    const e = toSwapLogEntry(swap({ isProxy: true }));
    expect(e.event).toBe("approved");
    expect(e.adminInitiated).toBe(true);
  });

  it("交代: 記録 (#215) でも立つ", () => {
    expect(toSwapLogEntry(swap({ isRecorded: true })).adminInitiated).toBe(true);
  });

  it("交代: 代理募集を取り下げた行でも立つ (#231)", () => {
    const e = toSwapLogEntry(
      swap({
        status: "cancelled",
        isProxy: true,
        actorName: "教室長A",
        approvedApplicantName: null,
      }),
    );
    expect(e.event).toBe("withdrawn-by-admin");
    expect(e.adminInitiated).toBe(true);
  });
});

describe("eventLabel", () => {
  it("9 種すべてを固定する", () => {
    // 画面は eventLabel を並べるだけにする設計なので、ラベルは製品面そのもの。
    // 嘘が出やすいのは「取り消し」「失効」側なので全部固定する
    expect(EVENT_LABEL).toEqual({
      pending: "未対応",
      approved: "承認",
      registered: "代理登録",
      recorded: "記録",
      rejected: "却下",
      "cancelled-by-admin": "取り消し",
      "withdrawn-by-admin": "教室長が取り下げ",
      "cancelled-by-tutor": "講師が取り下げ",
      "auto-expired": "失効（交代成立による）",
    });
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
      [
        [at("a", "2026-08-20T00:00:00.000Z"), at("b", "2026-08-24T00:00:00.000Z")],
        [at("c", "2026-08-22T00:00:00.000Z")],
      ],
      10,
    );
    expect(merged.rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(merged.truncated).toBe(false);
  });

  it("limit で切り、まだ先があれば truncated", () => {
    const merged = mergeLogEntries(
      [
        [at("a", "2026-08-20T00:00:00.000Z"), at("b", "2026-08-24T00:00:00.000Z")],
        [at("c", "2026-08-22T00:00:00.000Z")],
      ],
      2,
    );
    expect(merged.rows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(merged.truncated).toBe(true);
  });

  it("ちょうど limit 件のときは truncated が立たない", () => {
    // `>= limit` にすると「残りが無いのに『まだあります』」が出る
    const merged = mergeLogEntries(
      [
        [at("a", "2026-08-20T00:00:00.000Z"), at("b", "2026-08-24T00:00:00.000Z")],
        [at("c", "2026-08-22T00:00:00.000Z")],
      ],
      3,
    );
    expect(merged.rows).toHaveLength(3);
    expect(merged.truncated).toBe(false);
  });

  it("同時刻は id で安定させる (ページングの前提)", () => {
    const same = "2026-08-24T00:00:00.000Z";
    expect(
      mergeLogEntries([[at("b", same)], [at("a", same)]], 10).rows.map(
        (r) => r.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("片方が空でも動く", () => {
    expect(
      mergeLogEntries([[], [at("a", "2026-08-20T00:00:00.000Z")]], 10).rows,
    ).toHaveLength(1);
    expect(mergeLogEntries([[], []], 10)).toEqual({ rows: [], truncated: false });
    // 3 本以上でも動く (承認済み/取り消し済みで取得が 2 本を超えるため)
    expect(
      mergeLogEntries(
        [
          [at("a", "2026-08-20T00:00:00.000Z")],
          [at("b", "2026-08-22T00:00:00.000Z")],
          [at("c", "2026-08-24T00:00:00.000Z")],
        ],
        10,
      ).rows.map((r) => r.id),
    ).toEqual(["c", "b", "a"]);
  });
});
