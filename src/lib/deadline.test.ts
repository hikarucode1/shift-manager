import { describe, it, expect } from "vitest";
import { deadlineLabel } from "./deadline";

describe("deadlineLabel", () => {
  it("締切超過 (負の残日数) は urgent", () => {
    expect(deadlineLabel(-1)).toEqual({ text: "締切超過", urgent: true });
    expect(deadlineLabel(-30)).toEqual({ text: "締切超過", urgent: true });
  });

  it("本日締切 (0) は urgent", () => {
    expect(deadlineLabel(0)).toEqual({ text: "本日締切", urgent: true });
  });

  it("残り 1〜3 日は近接として urgent", () => {
    expect(deadlineLabel(1)).toEqual({ text: "あと1日", urgent: true });
    expect(deadlineLabel(3)).toEqual({ text: "あと3日", urgent: true });
  });

  it("残り 4 日以上は非緊急", () => {
    expect(deadlineLabel(4)).toEqual({ text: "あと4日", urgent: false });
    expect(deadlineLabel(10)).toEqual({ text: "あと10日", urgent: false });
  });
});
