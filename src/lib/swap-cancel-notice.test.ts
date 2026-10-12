import { describe, expect, it } from "vitest";
import { pendingSwapApproval } from "@/lib/pending-swap-approval";
import {
  noLongerApprovableForApplicants,
  ORPHANED_WHY,
  substituteCancelSuffix,
  swapCancelNotice,
} from "@/lib/swap-cancel-notice";

const none = {
  expiredAbsences: 0,
  substituteExpiredName: null,
  substituteSwapClosedName: null,
  requesterSwapClosedName: null,
  requesterPendingSwap: null,
};

describe("swapCancelNotice", () => {
  it("何も無ければ一文だけ", () => {
    expect(swapCancelNotice(none)).toBe("取り消しました。");
  });

  it("欠勤の自動失効は登録し直しを促す (#225。従来の文言のまま)", () => {
    expect(swapCancelNotice({ ...none, expiredAbsences: 1 })).toBe(
      "取り消しました。このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  });

  it("代講者の欠勤を失効させたら、誰の分かを出し、戻し方は誤操作の場合だけ書く (#291)", () => {
    const text = swapCancelNotice({ ...none, substituteExpiredName: "佐藤" });
    expect(text).toBe(
      "取り消しました。代講者の 佐藤 さんがこのコマに出していた欠勤申請は、担当でなくなったため失効させました（取り消しが誤りで、佐藤 さんが実際には休む場合は、記録し直したあと「代理で欠勤を登録する」から登録してください）。",
    );
    // ふだんの「登録し直して」(元講師向け) は出さない
    expect(text).not.toContain(
      "必要なら「代理で欠勤を登録する」から登録し直してください",
    );
  });

  it("代講者の募集はシステムが閉じたので、教室長に操作を頼まない (#293)", () => {
    const text = swapCancelNotice({
      ...none,
      substituteSwapClosedName: "佐藤",
    });
    expect(text).toContain(
      "代講者の 佐藤 さんがこのコマに出していた交代・代講の募集は、担当でなくなって承認できなくなったため締め切りました。",
    );
    expect(text).not.toMatch(/却下|取り下げて/);
  });

  it("記録のときに閉じた元講師の募集は、開き直さず募集し直しを案内する (#293)", () => {
    const text = swapCancelNotice({ ...none, requesterSwapClosedName: "山田" });
    expect(text).toContain(
      "山田 さんがこのコマに出していた交代・代講の募集は、記録したときに締め切っています。",
    );
    expect(text).toContain("「代理で代講を募集する」から募集し直してください");
    // 以前の #283「再び承認できます」は出さない
    expect(text).not.toContain("再び承認");
  });

  it("全部あれば、元講師の失効 → 代講者の失効 → 代講者の募集 → 元講師の募集 の順", () => {
    const text = swapCancelNotice({
      expiredAbsences: 1,
      substituteExpiredName: "佐藤",
      substituteSwapClosedName: "佐藤",
      requesterSwapClosedName: "山田",
      requesterPendingSwap: null,
    });
    const order = [
      "交代成立時に自動失効",
      "欠勤申請は、担当でなくなったため失効",
      "交代・代講の募集は、担当でなくなって",
      "記録したときに締め切って",
    ].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("#293 より前の記録で残っていた元講師の募集は、教室長にだけ知らせる", () => {
    const entry = (isProxy: boolean, isPastDate: boolean) => ({
      requesterName: "山田",
      isProxy,
      approval: pendingSwapApproval({
        isPastDate,
        requesterAssigned: true,
        isEnded: false,
        isProxy,
      }),
    });
    expect(
      swapCancelNotice({ ...none, requesterPendingSwap: entry(false, false) }),
    ).toBe(
      "取り消しました。このコマには 山田 さんの交代申請が残っていて、担当が戻ったため再び承認できます。「未対応」タブで承認するか、却下してください。",
    );
    // 代理募集の閉じ方は「取り下げ」(#231)
    expect(
      swapCancelNotice({ ...none, requesterPendingSwap: entry(true, false) }),
    ).toContain("承認するか、取り下げてください。");
    // 過去のコマは承認できない
    expect(
      swapCancelNotice({ ...none, requesterPendingSwap: entry(false, true) }),
    ).toContain(
      "「未対応」タブに残っています。過去のコマのため承認できません。",
    );
  });

  it("講師に知らせたとは言わない (通知は best-effort)", () => {
    const text = swapCancelNotice({
      expiredAbsences: 1,
      substituteExpiredName: "佐藤",
      substituteSwapClosedName: "佐藤",
      requesterSwapClosedName: "山田",
      requesterPendingSwap: null,
    });
    expect(text).not.toContain("通知");
  });
});

describe("substituteCancelSuffix (#287 / #293)", () => {
  it("B の名前で出ていた募集を閉じていなければ何も足さない", () => {
    expect(substituteCancelSuffix(false)).toBe("");
  });

  it("閉じたら、締め切ったことだけを書く (教室長の対応は待たせない)", () => {
    const s = substituteCancelSuffix(true);
    expect(s).toContain(
      "あなたの名前で出ていた交代・代講の募集は締め切りました",
    );
    expect(s).not.toContain("教室長が対応します");
  });

  it("B には取り下げを頼まない", () => {
    expect(substituteCancelSuffix(true)).not.toContain("取り下げ");
  });

  it("「あなたが出した」とは書かない (代理募集のこともある)", () => {
    expect(substituteCancelSuffix(true)).not.toContain("あなたが出した");
  });
});

describe("応募者への通知 (#253 / #288 / #293)", () => {
  it("締め切られたことを、誰の募集かと理由とともに伝える", () => {
    expect(
      noLongerApprovableForApplicants(
        "2026-10-11",
        "1限",
        "佐藤",
        ORPHANED_WHY.cancelled,
      ),
    ).toEqual({
      type: "swap_result",
      title: "応募していた代講の募集は締め切られました",
      body: "対象: 2026-10-11 1限 (佐藤さんの募集) ／ 代講が取り消され、このコマの担当が元に戻りました。担当が変わって承認できなくなったため、募集は締め切られました。",
      href: "/tutor/open-swaps",
    });
  });

  it("記録の理由も同じ題で出す", () => {
    const n = noLongerApprovableForApplicants(
      "2026-10-11",
      "1限",
      "山田",
      ORPHANED_WHY.recorded,
    );
    expect(n.title).toBe("応募していた代講の募集は締め切られました");
    expect(n.body).toContain(
      "(山田さんの募集) ／ このコマは別の形で対応されました。",
    );
  });

  it("取り消しの理由は名前を出さない (元講師本人も宛先に入る)", () => {
    expect(ORPHANED_WHY.cancelled).not.toMatch(/さん/);
  });
});
