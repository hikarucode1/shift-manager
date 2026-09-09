import { describe, it, expect } from "vitest";
import {
  pendingSwapApproval,
  type PendingSwapApprovalState,
} from "./pending-swap-approval";

const st = (
  o: Partial<PendingSwapApprovalState> = {},
): PendingSwapApprovalState => ({
  isPastDate: false,
  requesterAssigned: true,
  isEnded: false,
  isProxy: false,
  ...o,
});

describe("pendingSwapApproval (#262)", () => {
  it("担当が変わった募集は承認できない", () => {
    // ⚠️ #262 の本体。従来は承認ボタンが有効なままで、押すと必ず
    // 「付け替え対象の確定シフトが見つかりません」になっていた
    expect(pendingSwapApproval(st({ requesterAssigned: false }))).toEqual({
      approvable: false,
      heading: "このコマは担当が変わったため承認できません (却下は可能です):",
    });
  });

  it("代理募集なら閉じ方は「取り下げ」", () => {
    // #231: 本人が出していない申請を「却下」と言わない
    expect(
      pendingSwapApproval(st({ requesterAssigned: false, isProxy: true }))
        .heading,
    ).toContain("取り下げは可能です");
  });

  it("過去日は担当が変わっていても「過去のコマ」と言う", () => {
    // ⚠️ サーバー (`decideSwapRequest`) は過去日チェックを付け替えより先に
    // 行う。UI が別の理由を出すと、教室長が直したつもりで直らない
    expect(
      pendingSwapApproval(st({ isPastDate: true, requesterAssigned: false }))
        .heading,
    ).toContain("過去のコマ");
  });

  it("過去日は承認できない", () => {
    expect(pendingSwapApproval(st({ isPastDate: true })).approvable).toBe(false);
  });

  it("終了しただけの同日コマは承認できる（注意のみ）", () => {
    // #178: 応募が付いた案件を記録側へ移し替えさせるのは遠回り
    expect(pendingSwapApproval(st({ isEnded: true }))).toEqual({
      approvable: true,
      heading: "終了したコマです。実際に代講が入った場合のみ承認してください:",
    });
  });

  it("担当が変わっていれば、終了済みより先にそちらを言う", () => {
    expect(
      pendingSwapApproval(st({ isEnded: true, requesterAssigned: false })),
    ).toEqual({
      approvable: false,
      heading: "このコマは担当が変わったため承認できません (却下は可能です):",
    });
  });

  it("何も無ければ通常の見出しで承認できる", () => {
    expect(pendingSwapApproval(st())).toEqual({
      approvable: true,
      heading: "応募者から代講者を選んで承認:",
    });
  });
});
