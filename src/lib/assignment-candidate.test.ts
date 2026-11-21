import { describe, it, expect } from "vitest";
import {
  candidateMark,
  type CandidateState,
} from "./assignment-candidate";

const st = (o: Partial<CandidateState> = {}): CandidateState => ({
  absence: "none",
  hasPendingSwap: false,
  isEnded: false,
  isTraining: false,
  isUndecided: false,
  ...o,
});

describe("candidateMark: 代講の代理募集 (#227 / #230)", () => {
  it("承認済みの欠勤は「代講が必要」", () => {
    expect(candidateMark("swap", st({ absence: "approved" }))).toEqual({
      blocked: false,
      note: "欠勤あり（代講が必要）",
    });
  });

  it("未承認の欠勤は「未承認」と言い分ける", () => {
    // ⚠️ #230 の本体。一緒くたにすると、教室長がまだ判断していない申請を
    // 「欠勤が確定した」と読ませる。ここが「先に承認/却下して」の促しも兼ねる
    expect(candidateMark("swap", st({ absence: "pending" }))).toEqual({
      blocked: false,
      note: "欠勤申請あり（未承認）",
    });
  });

  it("欠勤があっても塞がない —「欠勤が確定していて代講を探す」が本命", () => {
    for (const absence of ["pending", "approved"] as const) {
      expect(candidateMark("swap", st({ absence })).blocked).toBe(false);
    }
  });

  it("pending の交代があれば塞ぐ", () => {
    expect(candidateMark("swap", st({ hasPendingSwap: true }))).toEqual({
      blocked: true,
      note: "既に交代申請あり",
    });
  });

  it("終了済みは塞ぐ (代わってもらう相手が居ない)", () => {
    expect(candidateMark("swap", st({ isEnded: true }))).toEqual({
      blocked: true,
      note: "終了済み",
    });
  });

  it("交代申請が終了済みより優先して説明される", () => {
    expect(
      candidateMark("swap", st({ hasPendingSwap: true, isEnded: true })).note,
    ).toBe("既に交代申請あり");
  });

  it("何も無ければ注記なし", () => {
    expect(candidateMark("swap", st())).toEqual({ blocked: false, note: null });
  });
});

describe("candidateMark: 欠勤の代理登録 (#217)", () => {
  it("欠勤があれば未承認・承認済みのどちらでも塞ぐ", () => {
    // 部分 unique (absence_requests_active_uniq) に当たるため
    for (const absence of ["pending", "approved"] as const) {
      expect(candidateMark("absence", st({ absence }))).toEqual({
        blocked: true,
        note: "既に欠勤の申請あり",
      });
    }
  });

  it("終了済みでも選べる — 事後に実態を記録するのが目的", () => {
    expect(candidateMark("absence", st({ isEnded: true }))).toEqual({
      blocked: false,
      note: "実施済み",
    });
  });

  it("交代申請があっても塞がない", () => {
    expect(candidateMark("absence", st({ hasPendingSwap: true })).blocked).toBe(
      false,
    );
  });
});

describe("candidateMark: 研修のコマ (2026/11/21)", () => {
  it("代講の代理募集では選べない", () => {
    expect(candidateMark("swap", st({ isTraining: true }))).toEqual({
      blocked: true,
      note: "研修は代講なし",
    });
  });

  it("欠勤の代理登録では選べて「研修」と添える", () => {
    expect(candidateMark("absence", st({ isTraining: true }))).toEqual({
      blocked: false,
      note: "研修",
    });
  });

  it("欠勤が既にあれば研修でも欠勤の重複を先に止める", () => {
    expect(
      candidateMark("absence", st({ isTraining: true, absence: "pending" })),
    ).toEqual({ blocked: true, note: "既に欠勤の申請あり" });
  });
});

describe("candidateMark: 未定のコマ (室長レビュー要望9)", () => {
  it("代講の代理募集では選べない", () => {
    expect(candidateMark("swap", st({ isUndecided: true }))).toEqual({
      blocked: true,
      note: "未定は代講なし",
    });
  });

  it("欠勤の代理登録では選べて「未定」と添える", () => {
    expect(candidateMark("absence", st({ isUndecided: true }))).toEqual({
      blocked: false,
      note: "未定",
    });
  });
});
