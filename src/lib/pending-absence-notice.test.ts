import { describe, expect, it } from "vitest";
import {
  ABSENCE_UNASSIGNED_NOTICE,
  pendingAbsenceNotice,
} from "@/lib/pending-absence-notice";

describe("pendingAbsenceNotice (#289)", () => {
  it("今も担当なら何も出さない", () => {
    expect(pendingAbsenceNotice({ tutorAssigned: true })).toBeNull();
  });

  it("担当が変わったコマは知らせを出す", () => {
    expect(pendingAbsenceNotice({ tutorAssigned: false })).toBe(
      ABSENCE_UNASSIGNED_NOTICE,
    );
  });

  it("却下だけを促さない (承認が正しい場面がある。PR #290)", () => {
    expect(ABSENCE_UNASSIGNED_NOTICE).toContain("承認");
    expect(ABSENCE_UNASSIGNED_NOTICE).toContain("却下");
  });
});
