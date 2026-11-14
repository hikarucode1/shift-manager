import { describe, expect, it } from "vitest";
import { regularSubmissionNotes } from "./regular-submission-notes";

describe("regularSubmissionNotes", () => {
  it("先頭は必ず「希望通りになるとは限らない」", () => {
    expect(regularSubmissionNotes(null)[0]).toBe("必ずしも希望通りになるとは限りません。");
  });
  it("受付中の期があれば終了日を出す", () => {
    expect(regularSubmissionNotes("2027-07-31").join("\n")).toContain(
      "この期の終わり（7月31日）まで",
    );
  });
  it("期が無ければ日付を出さない", () => {
    expect(regularSubmissionNotes(null).join("\n")).toContain("その期の終わりまで");
  });
});
