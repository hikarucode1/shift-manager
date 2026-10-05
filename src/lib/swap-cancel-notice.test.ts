import { describe, expect, it } from "vitest";
import {
  approvableAgainForApplicants,
  noLongerApprovableForApplicants,
  ORPHANED_WHY,
  planCancelNotices,
  substituteCancelSuffix,
  swapCancelNotice,
  type RecheckResult,
} from "@/lib/swap-cancel-notice";

const A = { id: "swap-a", isProxy: false };
const B = { id: "swap-b", isProxy: false };

/** 取り消し後の判断。指定しない募集は無いものとする */
const plan = (o: {
  requesterSwap?: { id: string; isProxy: boolean };
  requesterRecheck?: RecheckResult;
  substituteSwap?: { id: string; isProxy: boolean };
  substituteRecheck?: RecheckResult;
  isPastDate?: boolean;
}) =>
  planCancelNotices({
    requesterSwap: o.requesterSwap ?? null,
    requesterRecheck: o.requesterRecheck ?? "closed",
    substituteSwap: o.substituteSwap ?? null,
    substituteRecheck: o.substituteRecheck ?? "closed",
    isPastDate: o.isPastDate ?? false,
    requesterName: "山田",
    substituteName: "佐藤",
  });

/** 教室長への文言。planCancelNotices の出力をそのまま通す (実際のつながり) */
const adminText = (p: ReturnType<typeof plan>, expiredAbsences = 0) =>
  swapCancelNotice({ expiredAbsences, pendingSwaps: p.pendingSwaps });

describe("swapCancelNotice (planCancelNotices 経由)", () => {
  it("何も残っていなければ一文だけ", () => {
    expect(adminText(plan({}))).toBe("取り消しました。");
  });

  it("欠勤の自動失効は登録し直しを促す (#225。従来の文言のまま)", () => {
    expect(adminText(plan({}), 1)).toBe(
      "取り消しました。このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  });

  it("A の募集が再び承認できるなら、承認か閉じ方を 1 つに決めて促す (#283)", () => {
    expect(
      adminText(plan({ requesterSwap: A, requesterRecheck: "pending" })),
    ).toBe(
      "取り消しました。このコマには 山田 さんの交代申請が残っていて、担当が戻ったため再び承認できます。「未対応」タブで承認するか、却下してください。",
    );
    // 代理募集の閉じ方は「取り下げ」(#231)
    expect(
      adminText(
        plan({
          requesterSwap: { id: "swap-a", isProxy: true },
          requesterRecheck: "pending",
        }),
      ),
    ).toContain("承認するか、取り下げてください。");
  });

  it("A の募集が過去のコマなら、「未対応」タブと同じ理由で却下を促す (#283)", () => {
    expect(
      adminText(
        plan({
          requesterSwap: A,
          requesterRecheck: "pending",
          isPastDate: true,
        }),
      ),
    ).toBe(
      "取り消しました。このコマには 山田 さんの交代申請が「未対応」タブに残っています。過去のコマのため承認できません。却下してください。",
    );
  });

  it("B の募集は、担当が変わったため承認できないと出す (#287)", () => {
    expect(
      adminText(plan({ substituteSwap: B, substituteRecheck: "pending" })),
    ).toBe(
      "取り消しました。このコマには 佐藤 さんの交代申請が「未対応」タブに残っています。このコマは担当が変わったため承認できません。却下してください。",
    );
  });

  it("両方残っていれば A、B の順に出す (#283 / #287)", () => {
    const text = adminText(
      plan({
        requesterSwap: A,
        requesterRecheck: "pending",
        substituteSwap: { id: "swap-b", isProxy: true },
        substituteRecheck: "pending",
      }),
    );
    expect(text).toContain(
      "山田 さんの交代申請が残っていて、担当が戻ったため再び承認できます",
    );
    expect(text).toContain(
      "佐藤 さんの交代申請が「未対応」タブに残っています。このコマは担当が変わったため承認できません。取り下げてください。",
    );
    expect(text.indexOf("山田")).toBeLessThan(text.indexOf("佐藤"));
  });

  it("欠勤の自動失効と募集の両方があれば、両方出す", () => {
    const text = adminText(
      plan({ requesterSwap: A, requesterRecheck: "pending" }),
      2,
    );
    expect(text).toContain("自動失効しています");
    expect(text).toContain("再び承認できます");
    expect(text.indexOf("自動失効")).toBeLessThan(text.indexOf("再び承認"));
  });

  it("講師に知らせたとは言わない (通知は best-effort で、代講者には送らない)", () => {
    const text = adminText(
      plan({
        requesterSwap: A,
        requesterRecheck: "pending",
        substituteSwap: B,
        substituteRecheck: "pending",
      }),
    );
    expect(text).not.toContain("通知");
  });
});

describe("planCancelNotices の送り先 (#283 / #287 / #288)", () => {
  it("どちらの募集も無ければ何もしない", () => {
    expect(plan({})).toEqual({
      revivedSwapId: null,
      orphanedSwapId: null,
      pendingSwaps: [],
      substituteSuffix: "",
    });
  });

  it("A の募集: pending で承認できるときだけ「また有効」", () => {
    expect(
      plan({ requesterSwap: A, requesterRecheck: "pending" }).revivedSwapId,
    ).toBe("swap-a");
    // 過去のコマは承認できないので送らない
    expect(
      plan({ requesterSwap: A, requesterRecheck: "pending", isPastDate: true })
        .revivedSwapId,
    ).toBeNull();
  });

  it("A の募集: 閉じていた / 分からないときは送らず、教室長にも出さない", () => {
    for (const r of ["closed", "unknown"] as const) {
      const p = plan({ requesterSwap: A, requesterRecheck: r });
      expect(p.revivedSwapId).toBeNull();
      expect(p.pendingSwaps).toEqual([]);
    }
  });

  it("B の募集: pending なら応募者に送り、教室長と B にも出す", () => {
    const p = plan({ substituteSwap: B, substituteRecheck: "pending" });
    expect(p.orphanedSwapId).toBe("swap-b");
    expect(p.pendingSwaps).toHaveLength(1);
    expect(p.substituteSuffix).not.toBe("");
  });

  it("B の募集: 分からないときは応募者には送るが、教室長と B には出さない", () => {
    // B の募集は二度と承認できないので「承認できなくなりました」は嘘に
    // ならないが、閉じたかもしれない募集を「残っています」とは言わない
    const p = plan({ substituteSwap: B, substituteRecheck: "unknown" });
    expect(p.orphanedSwapId).toBe("swap-b");
    expect(p.pendingSwaps).toEqual([]);
    expect(p.substituteSuffix).toBe("");
  });

  it("B の募集: 閉じていたら誰にも出さない", () => {
    expect(plan({ substituteSwap: B, substituteRecheck: "closed" })).toEqual({
      revivedSwapId: null,
      orphanedSwapId: null,
      pendingSwaps: [],
      substituteSuffix: "",
    });
  });
});

describe("substituteCancelSuffix (#287 / #288)", () => {
  it("B の名前で募集が出ていなければ何も足さない", () => {
    expect(substituteCancelSuffix(false)).toBe("");
  });

  it("出ていれば承認できないことと、教室長が対応することを書く", () => {
    const s = substituteCancelSuffix(true);
    expect(s).toContain(
      "あなたの名前で出ている交代・代講の募集は承認できません",
    );
    expect(s).toContain("教室長が対応します。");
  });

  it("B には取り下げを頼まない (閉じるのは教室長だけ。2 通目を防ぐ)", () => {
    expect(substituteCancelSuffix(true)).not.toContain("取り下げ");
  });

  it("「あなたが出した」とは書かない (代理募集のこともある)", () => {
    expect(substituteCancelSuffix(true)).not.toContain("あなたが出した");
  });
});

describe("応募者への通知 (#253 / #283 / #288)", () => {
  it("「承認できなくなりました」は、誰の募集かと理由を入れる", () => {
    expect(
      noLongerApprovableForApplicants(
        "2026-10-11",
        "1限",
        "佐藤",
        ORPHANED_WHY.cancelled,
      ),
    ).toEqual({
      type: "swap_result",
      title: "応募していた代講の募集は承認できなくなりました",
      body: "対象: 2026-10-11 1限 (佐藤さんの募集) ／ 代講が取り消され、このコマの担当が元に戻ったため、この募集は承認できません。",
      href: "/tutor/open-swaps",
    });
  });

  it("取り消しの理由は名前を出さない (元講師本人も宛先に入る)", () => {
    expect(ORPHANED_WHY.cancelled).not.toMatch(/さん/);
  });

  it("「また有効になりました」も、誰の募集かを入れる", () => {
    expect(
      approvableAgainForApplicants("2026-10-11", "1限", "山田").body,
    ).toContain("(山田さんの募集)");
  });
});
