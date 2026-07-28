import { describe, it, expect } from "vitest";
import { isUniqueViolation, pgErrorCode } from "./db-errors";

// drizzle(postgres-js) が実 PG エラーを DrizzleQueryError で包み、SQLSTATE code は
// cause 側に入る構造を模す (#175 review で判明した dead check の原因)。
const wrapped = (code: string) => ({
  name: "DrizzleQueryError",
  message: "Failed query: ...",
  cause: { code, message: "some pg error" },
});

describe("pgErrorCode (#175)", () => {
  it("wrapper の cause 側にある code を取り出す", () => {
    expect(pgErrorCode(wrapped("23514"))).toBe("23514");
  });

  it("トップレベルに code がある (ラップされていない) 場合も取れる", () => {
    expect(pgErrorCode({ code: "23503" })).toBe("23503");
  });

  it("多段 cause を辿る", () => {
    expect(pgErrorCode({ cause: { cause: { code: "23505" } } })).toBe("23505");
  });

  it("code が無ければ null", () => {
    expect(pgErrorCode(new Error("boom"))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
    expect(pgErrorCode({ cause: {} })).toBeNull();
  });
});

describe("isUniqueViolation cause チェーン", () => {
  it("wrapper 越しの 23505 を検出", () => {
    expect(isUniqueViolation(wrapped("23505"))).toBe(true);
  });
  it("23514 は unique ではない", () => {
    expect(isUniqueViolation(wrapped("23514"))).toBe(false);
  });
});
