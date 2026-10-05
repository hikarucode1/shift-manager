import { describe, expect, it } from "vitest";
import { pendingSwapApproval } from "@/lib/pending-swap-approval";
import {
  planCancelNotices,
  substituteCancelNotice,
  swapCancelNotice,
} from "@/lib/swap-cancel-notice";

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
    expect(text).toContain(
      "山田 さんの交代申請が残っていて、担当が戻ったため再び承認できます",
    );
    expect(text).toContain(
      "佐藤 さんの交代申請が「未対応」タブに残っています。このコマは担当が変わったため承認できません。取り下げてください。",
    );
    expect(text.indexOf("山田")).toBeLessThan(text.indexOf("佐藤"));
  });
});

describe("substituteCancelNotice (#287 / #288)", () => {
  it("代講者の名前で募集が出ていなければ、何も足さず従来の行き先", () => {
    expect(substituteCancelNotice(null)).toEqual({
      bodySuffix: "",
      href: "/tutor/open-swaps",
    });
  });

  it("自分で出した募集なら、取り下げられる /tutor/swaps へ", () => {
    const n = substituteCancelNotice({ isProxy: false });
    expect(n.href).toBe("/tutor/swaps");
    expect(n.bodySuffix).toContain(
      "あなたの名前で出ている交代・代講の募集は承認できません",
    );
  });

  it("代理募集は代講者に取り下げられないので、従来の行き先のまま (#231)", () => {
    const n = substituteCancelNotice({ isProxy: true });
    expect(n.href).toBe("/tutor/open-swaps");
    expect(n.bodySuffix).not.toBe("");
  });

  it("「あなたが出した」とは書かない (代理募集のこともある)", () => {
    expect(substituteCancelNotice({ isProxy: true }).bodySuffix).not.toContain(
      "あなたが出した",
    );
  });
});

describe("planCancelNotices (#283 / #287 / #288)", () => {
  const A = { id: "swap-a", isProxy: false };
  const B = { id: "swap-b", isProxy: false };
  const base = {
    requesterSwap: null,
    requesterStill: false,
    substituteSwap: null,
    substituteStill: false,
    isPastDate: false,
    requesterName: "山田",
    substituteName: "佐藤",
  };

  it("どちらの募集も無ければ何もしない", () => {
    expect(planCancelNotices(base)).toEqual({
      revivedSwapId: null,
      orphanedSwapId: null,
      pendingSwaps: [],
      substitute: { bodySuffix: "", href: "/tutor/open-swaps" },
    });
  });

  it("A の募集がまだ pending で、まだ来ていないコマなら「また有効」", () => {
    const p = planCancelNotices({
      ...base,
      requesterSwap: A,
      requesterStill: true,
    });
    expect(p.revivedSwapId).toBe("swap-a");
    expect(p.pendingSwaps).toHaveLength(1);
    expect(p.pendingSwaps[0].approval.approvable).toBe(true);
  });

  it("A の募集が確かめ直しで閉じていたら、送らず、教室長にも出さない", () => {
    const p = planCancelNotices({
      ...base,
      requesterSwap: A,
      requesterStill: false,
    });
    expect(p.revivedSwapId).toBeNull();
    expect(p.pendingSwaps).toEqual([]);
  });

  it("A の募集が過去のコマなら「また有効」は送らず、教室長には却下を促す", () => {
    const p = planCancelNotices({
      ...base,
      requesterSwap: A,
      requesterStill: true,
      isPastDate: true,
    });
    expect(p.revivedSwapId).toBeNull();
    expect(p.pendingSwaps[0].approval.approvable).toBe(false);
  });

  it("B の募集がまだ pending なら「承認できなくなりました」と、B への追記", () => {
    const p = planCancelNotices({
      ...base,
      substituteSwap: B,
      substituteStill: true,
    });
    expect(p.orphanedSwapId).toBe("swap-b");
    expect(p.pendingSwaps[0].requesterName).toBe("佐藤");
    expect(p.pendingSwaps[0].approval.approvable).toBe(false);
    expect(p.substitute.href).toBe("/tutor/swaps");
    expect(p.substitute.bodySuffix).not.toBe("");
  });

  it("B の募集が確かめ直しで閉じていたら、応募者にも B にも教室長にも出さない", () => {
    const p = planCancelNotices({
      ...base,
      substituteSwap: B,
      substituteStill: false,
    });
    expect(p.orphanedSwapId).toBeNull();
    expect(p.pendingSwaps).toEqual([]);
    expect(p.substitute).toEqual({ bodySuffix: "", href: "/tutor/open-swaps" });
  });

  it("B の募集が代理募集なら、B の行き先は取り下げられない画面にしない", () => {
    const p = planCancelNotices({
      ...base,
      substituteSwap: { id: "swap-b", isProxy: true },
      substituteStill: true,
    });
    expect(p.substitute.href).toBe("/tutor/open-swaps");
  });

  it("両方残っていれば A、B の順に教室長へ出し、両方に送る", () => {
    const p = planCancelNotices({
      ...base,
      requesterSwap: A,
      requesterStill: true,
      substituteSwap: B,
      substituteStill: true,
    });
    expect(p.revivedSwapId).toBe("swap-a");
    expect(p.orphanedSwapId).toBe("swap-b");
    expect(p.pendingSwaps.map((e) => e.requesterName)).toEqual([
      "山田",
      "佐藤",
    ]);
  });
});
