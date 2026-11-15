import { describe, expect, it } from "vitest";
import { designationState, type LinkedSwap } from "./designated-substitution";

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
});
