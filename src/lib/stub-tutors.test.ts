import { describe, expect, it } from "vitest";
import { planStubTutors, stubEmail } from "./stub-tutors";

describe("planStubTutors", () => {
  it("空白を落として重複を除き、いない名前だけ作る", () => {
    expect(
      planStubTutors([" 山田 ", "山田", "佐藤", ""], [
        { id: "s1", displayName: "佐藤", isActive: true },
      ]),
    ).toEqual({
      ok: true,
      toCreate: ["山田"],
      existing: [{ name: "佐藤", id: "s1" }],
    });
  });

  it("同じ名前の講師が無効化されていたら作らずに止める", () => {
    expect(
      planStubTutors(["山田", "佐藤"], [
        { id: "y1", displayName: "山田", isActive: false },
      ]),
    ).toEqual({ ok: false, inactiveNames: ["山田"] });
  });
});

describe("stubEmail", () => {
  it("実在しない TLD の仮アドレスにする", () => {
    expect(stubEmail("abc")).toBe("stub-abc@example.invalid");
  });
});
