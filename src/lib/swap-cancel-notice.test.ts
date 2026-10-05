import { describe, expect, it } from "vitest";
import { swapCancelNotice } from "@/lib/swap-cancel-notice";

describe("swapCancelNotice", () => {
  it("何も残っていなければ一文だけ", () => {
    expect(swapCancelNotice({ expiredAbsences: 0, pendingSwap: null })).toBe(
      "取り消しました。",
    );
  });

  it("欠勤の自動失効は登録し直しを促す (#225。従来の文言のまま)", () => {
    expect(swapCancelNotice({ expiredAbsences: 1, pendingSwap: null })).toBe(
      "取り消しました。このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  });

  it("募集が再び承認できるなら、承認か却下を促す (#283)", () => {
    const text = swapCancelNotice({
      expiredAbsences: 0,
      pendingSwap: { requesterName: "山田", approvable: true },
    });
    expect(text).toContain("山田 さんの交代申請が残っていて、担当が戻ったため再び承認できます");
    // 訂正の通知は best-effort で、代講者には送らない。言い切らない
    expect(text).not.toContain("通知");
  });

  it("過去のコマは承認できないので、却下だけを促し、通知したとは言わない (#283)", () => {
    const text = swapCancelNotice({
      expiredAbsences: 0,
      pendingSwap: { requesterName: "山田", approvable: false },
    });
    expect(text).toContain("過去のコマなので承認できません");
    expect(text).not.toContain("再び承認できます");
    expect(text).not.toContain("通知");
  });

  it("失効と募集の両方があれば両方出す", () => {
    const text = swapCancelNotice({
      expiredAbsences: 2,
      pendingSwap: { requesterName: "山田", approvable: true },
    });
    expect(text).toContain("自動失効しています");
    expect(text).toContain("再び承認できます");
  });
});
