import { describe, expect, it } from "vitest";
import {
  designationState,
  unfilledAbsenceState,
  type LinkedSwap,
} from "./designated-substitution";

const base = {
  absenceStatus: "approved" as const,
  designatedId: "B",
  linkedSwaps: [] as LinkedSwap[],
  isEnded: false,
};
const swap = (over: Partial<LinkedSwap>): LinkedSwap => ({
  status: "pending",
  nominatedTutorId: "B",
  closeKind: null,
  ...over,
});

describe("designationState (#331)", () => {
  it("指定が無ければ何も出さない", () => {
    expect(designationState({ ...base, designatedId: null }).kind).toBe("none");
  });
  it("承認済みで依頼がまだなら、依頼ボタン", () => {
    expect(designationState(base).kind).toBe("can-request");
  });
  it("依頼中", () => {
    expect(designationState({ ...base, linkedSwaps: [swap({})] }).kind).toBe(
      "requested",
    );
  });
  it("成立すると欠勤は失効しているが、成立と出す", () => {
    expect(
      designationState({
        ...base,
        absenceStatus: "cancelled",
        linkedSwaps: [swap({ status: "approved" })],
      }).kind,
    ).toBe("accepted");
  });
  it("断られた", () => {
    expect(
      designationState({
        ...base,
        linkedSwaps: [
          swap({ status: "cancelled", closeKind: "nominee_declined" }),
        ],
      }).kind,
    ).toBe("declined");
  });
  it("教室長が指定し直したら、前の相手の断りは関係なく、新しい相手に依頼できる", () => {
    expect(
      designationState({
        ...base,
        designatedId: "C",
        linkedSwaps: [
          swap({ status: "cancelled", closeKind: "nominee_declined" }),
        ],
      }).kind,
    ).toBe("can-request");
  });
  it("講師が自分で取り下げた依頼は、もう一度出せる", () => {
    expect(
      designationState({
        ...base,
        linkedSwaps: [
          swap({ status: "cancelled", closeKind: "tutor_withdraw" }),
        ],
      }).kind,
    ).toBe("can-request");
  });
  it("コマが終わったら依頼ボタンは出さない", () => {
    expect(designationState({ ...base, isEnded: true }).kind).toBe("none");
  });
  it("欠勤が承認済みでなければ出さない", () => {
    expect(designationState({ ...base, absenceStatus: "pending" }).kind).toBe(
      "none",
    );
    expect(designationState({ ...base, absenceStatus: "rejected" }).kind).toBe(
      "none",
    );
  });

  describe("複数の相手に同時に依頼 (室長レビュー要望2)", () => {
    it("1 人が断っても、ほかに返事待ちがいれば依頼中", () => {
      expect(
        designationState({
          ...base,
          designatedId: "C",
          linkedSwaps: [
            swap({ status: "cancelled", closeKind: "nominee_declined" }),
            swap({ nominatedTutorId: "C" }),
          ],
        }).kind,
      ).toBe("requested");
    });
    it("全員に断られたら、断られた", () => {
      expect(
        designationState({
          ...base,
          designatedId: "C",
          linkedSwaps: [
            swap({ status: "cancelled", closeKind: "nominee_declined" }),
            swap({
              nominatedTutorId: "C",
              status: "cancelled",
              closeKind: "nominee_declined",
            }),
          ],
        }).kind,
      ).toBe("declined");
    });
    it("最後に指定した相手でなくても、誰かが引き受けたら成立", () => {
      expect(
        designationState({
          ...base,
          absenceStatus: "cancelled",
          designatedId: "C",
          linkedSwaps: [
            swap({ status: "approved" }),
            swap({
              nominatedTutorId: "C",
              status: "cancelled",
              closeKind: "unassignable",
            }),
          ],
        }).kind,
      ).toBe("accepted");
    });
  });
});

describe("unfilledAbsenceState (代講が決まっていない欠勤)", () => {
  const input = {
    designatedId: "B" as string | null,
    linkedSwaps: [] as LinkedSwap[],
    noSubstituteSlot: false,
  };
  it("指名した相手の返事待ち", () => {
    expect(unfilledAbsenceState({ ...input, linkedSwaps: [swap({})] })).toBe(
      "requested",
    );
  });
  it("指名した相手に断られた", () => {
    expect(
      unfilledAbsenceState({
        ...input,
        linkedSwaps: [
          swap({ status: "cancelled", closeKind: "nominee_declined" }),
        ],
      }),
    ).toBe("declined");
  });
  it("代講を決めずに承認した欠勤 (「何もしない」) も出す", () => {
    expect(unfilledAbsenceState({ ...input, designatedId: null })).toBe("none");
  });
  it("承認前に戻して依頼を取り下げたあと、代講を決めずに承認し直した欠勤も出す", () => {
    expect(
      unfilledAbsenceState({
        ...input,
        designatedId: null,
        linkedSwaps: [
          swap({ status: "cancelled", closeKind: "admin_withdraw" }),
        ],
      }),
    ).toBe("none");
  });
  it("研修・未定のコマは代講を立てないので、決めていなくても出さない", () => {
    expect(
      unfilledAbsenceState({
        ...input,
        designatedId: null,
        noSubstituteSlot: true,
      }),
    ).toBeNull();
  });
  it("指名したが依頼を送れていない欠勤は出さない (休む講師の画面に依頼ボタンが出る)", () => {
    expect(unfilledAbsenceState(input)).toBeNull();
  });
});
