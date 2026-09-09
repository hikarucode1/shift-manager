import { describe, it, expect } from "vitest";
import {
  assignmentKey,
  visibleOpenSwaps,
  type OpenSwapRow,
} from "./open-swap-visibility";

const row = (o: Partial<OpenSwapRow> = {}): OpenSwapRow => ({
  id: "req-1",
  kind: "open",
  requesterId: "yamada",
  nominatedTutorId: null,
  date: "2026-09-15",
  slotNumber: 3,
  ...o,
});

/** 申請者が担当のまま (= 承認できる) 状態 */
const assigned = new Set([assignmentKey("yamada", "2026-09-15", 3)]);
const none = new Set<string>();
const noApps = new Set<string>();

describe("visibleOpenSwaps (#259)", () => {
  it("申請者が担当のままなら出す", () => {
    expect(visibleOpenSwaps([row()], "me", noApps, assigned)).toHaveLength(1);
  });

  it("申請者が担当でなくなった募集は出さない", () => {
    // 記録 (#215) / 承認 / CSV 再取り込みで weekly_shifts の担当が変わると、
    // decideSwapRequest が必ず落とすので応募させてはいけない
    expect(visibleOpenSwaps([row()], "me", noApps, none)).toHaveLength(0);
  });

  it("応募済みなら、承認不能でも出す (取り下げ導線を残す)", () => {
    // ⚠️ #165 の再発防止。取り下げボタンはこの一覧にしかないので、落とすと
    // 取り下げ不能な応募になる
    expect(
      visibleOpenSwaps([row()], "me", new Set(["req-1"]), none),
    ).toHaveLength(1);
  });

  it("指名は自分宛でなければ、担当が残っていても出さない", () => {
    expect(
      visibleOpenSwaps(
        [row({ kind: "named", nominatedTutorId: "someone-else" })],
        "me",
        noApps,
        assigned,
      ),
    ).toHaveLength(0);
  });

  it("指名が自分宛なら出す", () => {
    expect(
      visibleOpenSwaps(
        [row({ kind: "named", nominatedTutorId: "me" })],
        "me",
        noApps,
        assigned,
      ),
    ).toHaveLength(1);
  });

  it("指名が自分宛でなければ、応募済みでも出さない", () => {
    // 応募済み優先を指名判定より前に置くと、自分宛でない指名が漏れる
    expect(
      visibleOpenSwaps(
        [row({ kind: "named", nominatedTutorId: "someone-else" })],
        "me",
        new Set(["req-1"]),
        assigned,
      ),
    ).toHaveLength(0);
  });

  it("日・コマ・担当者のどれかが違えば担当ありと見なさない", () => {
    for (const key of [
      assignmentKey("other", "2026-09-15", 3),
      assignmentKey("yamada", "2026-09-16", 3),
      assignmentKey("yamada", "2026-09-15", 4),
    ]) {
      expect(
        visibleOpenSwaps([row()], "me", noApps, new Set([key])),
      ).toHaveLength(0);
    }
  });
});
