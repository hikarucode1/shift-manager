import { describe, it, expect } from "vitest";
import {
  hasCurrentPeriodData,
  resolveServerEffectiveFrom,
  resolveSubmissionEffectiveFrom,
  selectPrefillSourceSubmission,
  submissionQueryLowerBound,
  type PrefillSourceCandidate,
} from "./regular-submission-target";

describe("resolveSubmissionEffectiveFrom", () => {
  it("受付中の期があれば、既存の古い提出日より必ず期の開始日を優先する (#156 の核心)", () => {
    // 7月に old draft (2026-07-14) が残っていても、受付中の10月期に提出するなら
    // 起点は 2026-10-01 でなければならない。
    expect(
      resolveSubmissionEffectiveFrom({
        activePeriodStartDate: "2026-10-01",
        latestEffectiveFrom: "2026-07-14",
        today: "2026-07-14",
      }),
    ).toBe("2026-10-01");
  });

  it("受付中の期があり既存提出が無くても、today ではなく期の開始日を使う", () => {
    expect(
      resolveSubmissionEffectiveFrom({
        activePeriodStartDate: "2026-10-01",
        latestEffectiveFrom: null,
        today: "2026-07-14",
      }),
    ).toBe("2026-10-01");
  });

  it("既に当該期の draft がある場合は期初と一致し、復元と保存の起点が揃う", () => {
    expect(
      resolveSubmissionEffectiveFrom({
        activePeriodStartDate: "2026-10-01",
        latestEffectiveFrom: "2026-10-01",
        today: "2026-07-14",
      }),
    ).toBe("2026-10-01");
  });

  it("受付中の期が無い場合は最新の既存提出日にフォールバックする", () => {
    expect(
      resolveSubmissionEffectiveFrom({
        activePeriodStartDate: null,
        latestEffectiveFrom: "2026-08-01",
        today: "2026-07-14",
      }),
    ).toBe("2026-08-01");
  });

  it("受付中の期も既存提出も無い場合は today", () => {
    expect(
      resolveSubmissionEffectiveFrom({
        activePeriodStartDate: null,
        latestEffectiveFrom: null,
        today: "2026-07-14",
      }),
    ).toBe("2026-07-14");
  });
});

describe("resolveServerEffectiveFrom", () => {
  it("受付中の期があれば、クライアント指定を無視して期の開始日を強制する (改竄防止)", () => {
    // クライアントが disabled を迂回して7月の途中日を送っても、10月期が受付中なら
    // 起点は 2026-10-01 に強制される。
    expect(
      resolveServerEffectiveFrom({
        activePeriodStartDate: "2026-10-01",
        clientEffectiveFrom: "2026-07-14",
      }),
    ).toBe("2026-10-01");
  });

  it("受付中の期が無ければクライアント指定を使う (アドホック提出)", () => {
    expect(
      resolveServerEffectiveFrom({
        activePeriodStartDate: null,
        clientEffectiveFrom: "2026-07-14",
      }),
    ).toBe("2026-07-14");
  });

  it("resolveSubmissionEffectiveFrom と違い latestEffectiveFrom フォールバックは持たない", () => {
    // 期があれば必ず期初。無ければクライアント指定そのまま (今日への暗黙フォールバック無し)。
    expect(
      resolveServerEffectiveFrom({
        activePeriodStartDate: "2026-10-01",
        clientEffectiveFrom: "2026-10-15",
      }),
    ).toBe("2026-10-01");
  });
});

describe("submissionQueryLowerBound", () => {
  it("期初が未来日 (提出は期の前) の通常ケースでは today を下限にする", () => {
    expect(
      submissionQueryLowerBound({
        activePeriodStartDate: "2026-10-01",
        today: "2026-07-14",
      }),
    ).toBe("2026-07-14");
  });

  it("期初が過去日 (期の開始後の遅れ提出) では期初まで下限を広げる", () => {
    expect(
      submissionQueryLowerBound({
        activePeriodStartDate: "2026-07-01",
        today: "2026-07-14",
      }),
    ).toBe("2026-07-01");
  });

  it("受付中の期が無ければ today", () => {
    expect(
      submissionQueryLowerBound({
        activePeriodStartDate: null,
        today: "2026-07-14",
      }),
    ).toBe("2026-07-14");
  });

  it("期初 == today の境界では today", () => {
    expect(
      submissionQueryLowerBound({
        activePeriodStartDate: "2026-07-14",
        today: "2026-07-14",
      }),
    ).toBe("2026-07-14");
  });
});

describe("selectPrefillSourceSubmission (#161)", () => {
  const cand = (
    effectiveFrom: string,
    effectiveTo: string | null = null,
  ): PrefillSourceCandidate => ({
    effectiveFrom,
    effectiveTo,
    desiredDays: null,
    desiredSlots: null,
  });

  it("target より前の提出のうち最新を選ぶ", () => {
    const src = selectPrefillSourceSubmission({
      candidates: [cand("2026-04-01"), cand("2026-07-01"), cand("2026-01-01")],
      targetEffectiveFrom: "2026-10-01",
    });
    expect(src?.effectiveFrom).toBe("2026-07-01");
  });

  it("全コマ不可 (メタのみ) の直近提出も候補に含み、古い期を飛ばさない", () => {
    // 7月に全コマ不可で提出 (fixed_shifts 行なし) → その提出が最新なら 7月を選ぶ。
    // 呼び出し側は entries 空なら prefill しないので、結果として「引き継がない」。
    const src = selectPrefillSourceSubmission({
      candidates: [cand("2026-04-01"), cand("2026-07-01")],
      targetEffectiveFrom: "2026-10-01",
    });
    expect(src?.effectiveFrom).toBe("2026-07-01");
  });

  it("target 以降の提出は候補にしない", () => {
    const src = selectPrefillSourceSubmission({
      candidates: [cand("2026-10-01"), cand("2026-12-01")],
      targetEffectiveFrom: "2026-10-01",
    });
    expect(src).toBeNull();
  });

  it("適用終了日が新期開始より前 = 明示的に終了させたパターンは引き継がない", () => {
    const src = selectPrefillSourceSubmission({
      candidates: [cand("2026-07-01", "2026-08-31")],
      targetEffectiveFrom: "2026-10-01",
    });
    expect(src).toBeNull();
  });

  it("適用終了日が新期開始以降なら引き継ぐ", () => {
    const src = selectPrefillSourceSubmission({
      candidates: [cand("2026-07-01", "2026-12-31")],
      targetEffectiveFrom: "2026-10-01",
    });
    expect(src?.effectiveFrom).toBe("2026-07-01");
  });

  it("候補が無ければ null", () => {
    expect(
      selectPrefillSourceSubmission({
        candidates: [],
        targetEffectiveFrom: "2026-10-01",
      }),
    ).toBeNull();
  });
});

describe("hasCurrentPeriodData (#161)", () => {
  it("提出行があれば true", () => {
    expect(
      hasCurrentPeriodData({
        hasSubmissionRow: true,
        hasAnyRawFixedShiftRow: false,
      }),
    ).toBe(true);
  });

  it("全コマ不可の生行だけでも true (プリフィルで上書きしない)", () => {
    expect(
      hasCurrentPeriodData({
        hasSubmissionRow: false,
        hasAnyRawFixedShiftRow: true,
      }),
    ).toBe(true);
  });

  it("どちらも無ければ false (プリフィル可)", () => {
    expect(
      hasCurrentPeriodData({
        hasSubmissionRow: false,
        hasAnyRawFixedShiftRow: false,
      }),
    ).toBe(false);
  });
});
