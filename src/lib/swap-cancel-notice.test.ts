import { describe, expect, it } from "vitest";
import { pendingSwapApproval } from "@/lib/pending-swap-approval";
import { swapCancelNotice } from "@/lib/swap-cancel-notice";

/**
 * 取り消し側と同じ判定で作る。元講師 (山田) の募集は担当に戻ったので
 * requesterAssigned: true、代講者 (佐藤) の募集は担当でなくなったので false
 */
const pending = (o: {
  isPastDate: boolean;
  isProxy: boolean;
  requesterName?: string;
  requesterAssigned?: boolean;
}) => ({
  requesterName: o.requesterName ?? "山田",
  isProxy: o.isProxy,
  approval: pendingSwapApproval({
    isPastDate: o.isPastDate,
    requesterAssigned: o.requesterAssigned ?? true,
    isEnded: false,
    isProxy: o.isProxy,
  }),
});
const substitute = (o: { isPastDate: boolean; isProxy: boolean }) =>
  pending({ ...o, requesterName: "佐藤", requesterAssigned: false });

describe("swapCancelNotice", () => {
  it("何も残っていなければ一文だけ", () => {
    expect(swapCancelNotice({ expiredAbsences: 0, pendingSwaps: [] })).toBe(
      "取り消しました。",
    );
  });

  it("欠勤の自動失効は登録し直しを促す (#225。従来の文言のまま)", () => {
    expect(swapCancelNotice({ expiredAbsences: 1, pendingSwaps: [] })).toBe(
      "取り消しました。このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  });

  it("募集が再び承認できるなら、承認か閉じ方を 1 つに決めて促す (#283)", () => {
    expect(
      swapCancelNotice({
        expiredAbsences: 0,
        pendingSwaps: [pending({ isPastDate: false, isProxy: false })],
      }),
    ).toBe(
      "取り消しました。このコマには 山田 さんの交代申請が残っていて、担当が戻ったため再び承認できます。「未対応」タブで承認するか、却下してください。",
    );
    // 代理募集の閉じ方は「取り下げ」(#231)
    expect(
      swapCancelNotice({
        expiredAbsences: 0,
        pendingSwaps: [pending({ isPastDate: false, isProxy: true })],
      }),
    ).toContain("承認するか、取り下げてください。");
  });

  it("承認できないときは「未対応」タブと同じ理由と閉じ方を出す (#283)", () => {
    const text = swapCancelNotice({
      expiredAbsences: 0,
      pendingSwaps: [pending({ isPastDate: true, isProxy: false })],
    });
    expect(text).toBe(
      "取り消しました。このコマには 山田 さんの交代申請が「未対応」タブに残っています。過去のコマのため承認できません。却下してください。",
    );
  });

  it("講師に知らせたとは言わない (訂正は best-effort で、代講者には送らない)", () => {
    for (const isPastDate of [false, true]) {
      for (const isProxy of [false, true]) {
        expect(
          swapCancelNotice({
            expiredAbsences: 0,
            pendingSwaps: [pending({ isPastDate, isProxy })],
          }),
        ).not.toContain("通知");
      }
    }
  });

  it("失効と募集の両方があれば両方出す", () => {
    const text = swapCancelNotice({
      expiredAbsences: 2,
      pendingSwaps: [pending({ isPastDate: false, isProxy: false })],
    });
    expect(text).toContain("自動失効しています");
    expect(text).toContain("再び承認できます");
  });

  it("代講者が出した募集は、担当が変わったため承認できないと出す (#287)", () => {
    expect(
      swapCancelNotice({
        expiredAbsences: 0,
        pendingSwaps: [substitute({ isPastDate: false, isProxy: false })],
      }),
    ).toBe(
      "取り消しました。このコマには 佐藤 さんの交代申請が「未対応」タブに残っています。このコマは担当が変わったため承認できません。却下してください。",
    );
  });

  it("元講師と代講者の募集が両方残っていれば、両方を順に出す (#283 / #287)", () => {
    const text = swapCancelNotice({
      expiredAbsences: 0,
      pendingSwaps: [
        pending({ isPastDate: false, isProxy: false }),
        substitute({ isPastDate: false, isProxy: true }),
      ],
    });
    expect(text).toContain("山田 さんの交代申請が残っていて、担当が戻ったため再び承認できます");
    expect(text).toContain(
      "佐藤 さんの交代申請が「未対応」タブに残っています。このコマは担当が変わったため承認できません。取り下げてください。",
    );
    expect(text.indexOf("山田")).toBeLessThan(text.indexOf("佐藤"));
  });
});
