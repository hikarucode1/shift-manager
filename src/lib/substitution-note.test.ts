import { describe, expect, it } from "vitest";
import { substitutionNote } from "@/lib/substitution-note";

describe("substitutionNote", () => {
  // ⚠️ 承認時 (decideSwapRequest) と CSV 取り込み後の再適用 (upload-commit) の
  // 両方がこれを使う。片方だけ変えると同じ事実に 2 通りの記録が残り、後から
  // 読む人が別物だと誤解する。形を変えるならこのテストごと変えること。
  it("承認済み代講の痕跡を A → B の形で残す", () => {
    expect(substitutionNote("サトウ", "タナカ")).toBe(
      "代講(承認済): サトウ → タナカ",
    );
  });

  it("名前が引けなかった場合も形は崩れない", () => {
    // 呼び出し側は不明時に "不明" を渡す。ここで空文字にすると
    // 「代講(承認済):  → 」のような読めない記録が残る。
    expect(substitutionNote("不明", "タナカ")).toBe(
      "代講(承認済): 不明 → タナカ",
    );
  });
});
