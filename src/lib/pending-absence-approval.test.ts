import { describe, expect, it } from "vitest";
import {
  ABSENCE_UNASSIGNED_NOTICE,
  pendingAbsenceApproval,
} from "@/lib/pending-absence-approval";

describe("pendingAbsenceApproval (#289)", () => {
  it("今も担当なら承認できる", () => {
    expect(pendingAbsenceApproval({ tutorAssigned: true })).toEqual({
      approvable: true,
      notice: null,
    });
  });

  it("担当が変わったコマは承認させず、却下を促す", () => {
    expect(pendingAbsenceApproval({ tutorAssigned: false })).toEqual({
      approvable: false,
      notice: "このコマは担当が変わったため承認できません。却下してください。",
    });
    expect(ABSENCE_UNASSIGNED_NOTICE).toContain("却下してください");
  });
});
