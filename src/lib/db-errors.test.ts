import { describe, it, expect } from "vitest";
import { isUniqueViolation, pgErrorCode, pgConstraintName } from "./db-errors";

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

describe("pgConstraintName (#221)", () => {
  it("postgres-js の constraint_name を cause 越しに取る", () => {
    expect(
      pgConstraintName({
        name: "DrizzleQueryError",
        message: "Failed query: ...",
        cause: {
          code: "23514",
          constraint_name: "regular_shift_periods_due_within_period_chk",
        },
      }),
    ).toBe("regular_shift_periods_due_within_period_chk");
  });

  it("node-postgres 形式の constraint も取る", () => {
    expect(pgConstraintName({ constraint: "some_chk" })).toBe("some_chk");
  });

  it("フィールドが無ければメッセージ本文から拾う", () => {
    expect(
      pgConstraintName({
        cause: {
          code: "23514",
          message:
            'new row for relation "regular_shift_periods" violates check constraint "regular_shift_periods_due_within_period_chk"',
        },
      }),
    ).toBe("regular_shift_periods_due_within_period_chk");
  });

  it("trigger が RAISE したエラーは制約名を持たないので null", () => {
    // #176 の 0026 / 0033 trigger がこれ。判別できないので併記に落とす
    expect(
      pgConstraintName({
        cause: {
          code: "23514",
          message: "period range does not cover child rows",
        },
      }),
    ).toBeNull();
  });

  it("制約名が無ければ null", () => {
    expect(pgConstraintName(new Error("boom"))).toBeNull();
    expect(pgConstraintName(null)).toBeNull();
  });
});
