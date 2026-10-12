import { describe, expect, it } from "vitest";
import { absenceCloseFlags } from "@/lib/absence-close-kind";

describe("absenceCloseFlags (#292)", () => {
  it("閉じ方の種類ごとに、対応する印だけが立つ", () => {
    expect(absenceCloseFlags("auto_expired")).toEqual({
      autoExpired: true,
      closedUnassigned: false,
      expiredUnassigned: false,
    });
    expect(absenceCloseFlags("unassigned")).toEqual({
      autoExpired: false,
      closedUnassigned: true,
      expiredUnassigned: false,
    });
    expect(absenceCloseFlags("expired_unassigned")).toEqual({
      autoExpired: false,
      closedUnassigned: false,
      expiredUnassigned: true,
    });
  });

  it("講師の取り下げ・教室長の取り消し・閉じていない行は、どれも立たない", () => {
    const none = {
      autoExpired: false,
      closedUnassigned: false,
      expiredUnassigned: false,
    };
    expect(absenceCloseFlags("tutor_withdraw")).toEqual(none);
    // 教室長が理由欄に定型文と同じ文を書いても、種類は admin_cancel
    expect(absenceCloseFlags("admin_cancel")).toEqual(none);
    expect(absenceCloseFlags(null)).toEqual(none);
  });
});
