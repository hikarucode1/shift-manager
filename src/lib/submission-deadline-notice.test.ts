import { describe, expect, it } from "vitest";
import {
  courseEveNotice,
  deadlineEveAt,
  isDeadlineEveDue,
  regularEveNotice,
} from "./submission-deadline-notice";

const at = (s: string) => new Date(s);

describe("deadlineEveAt", () => {
  it("締切日の前日 16:00 (JST)", () => {
    expect(deadlineEveAt(at("2026-12-10T23:59:59.999+09:00"))).toEqual(
      at("2026-12-09T16:00:00+09:00"),
    );
  });

  it("23:59 締切でも同じ", () => {
    expect(deadlineEveAt(at("2026-12-12T23:59:00+09:00"))).toEqual(
      at("2026-12-11T16:00:00+09:00"),
    );
  });

  it("0:00 ちょうどの締切は前の日の終わりとみなす", () => {
    // 3/2 0:00 締切 = 3/1 まで → 前日は 2/28
    expect(deadlineEveAt(at("2027-03-02T00:00:00+09:00"))).toEqual(
      at("2027-02-28T16:00:00+09:00"),
    );
  });
});

describe("isDeadlineEveDue", () => {
  const base = {
    deadline: at("2026-12-10T23:59:59.999+09:00"),
    createdAt: at("2026-11-20T10:00:00+09:00"),
    opensAt: null,
  };

  it("前日 16:00 より前は送らない", () => {
    expect(isDeadlineEveDue(base, at("2026-12-09T15:59:00+09:00"))).toBe(false);
  });

  it("前日 16:00 を過ぎたら送る", () => {
    expect(isDeadlineEveDue(base, at("2026-12-09T16:00:00+09:00"))).toBe(true);
    expect(isDeadlineEveDue(base, at("2026-12-09T16:05:00+09:00"))).toBe(true);
  });

  it("6 時間より遅れて気づいたら送らない (夜中に届かないように)", () => {
    expect(isDeadlineEveDue(base, at("2026-12-09T22:00:00+09:00"))).toBe(true);
    expect(isDeadlineEveDue(base, at("2026-12-09T22:01:00+09:00"))).toBe(false);
  });

  it("前日 16:00 を過ぎてから作った期には送らない", () => {
    expect(
      isDeadlineEveDue(
        { ...base, createdAt: at("2026-12-09T16:30:00+09:00") },
        at("2026-12-09T16:35:00+09:00"),
      ),
    ).toBe(false);
  });

  it("受付がまだ始まっていなければ送らない", () => {
    expect(
      isDeadlineEveDue(
        { ...base, opensAt: at("2026-12-09T18:00:00+09:00") },
        at("2026-12-09T16:05:00+09:00"),
      ),
    ).toBe(false);
    expect(
      isDeadlineEveDue(
        { ...base, opensAt: at("2026-12-01T00:00:00+09:00") },
        at("2026-12-09T16:05:00+09:00"),
      ),
    ).toBe(true);
  });
});

describe("courseEveNotice / regularEveNotice", () => {
  it("講習: 名前と締切日、全員向けの一言", () => {
    const n = courseEveNotice({
      id: "p1",
      name: "2026年 冬期講習",
      submissionDeadline: at("2026-12-10T23:59:59.999+09:00"),
    });
    expect(n.title).toBe("講習のシフト希望の締切は明日です（2026年 冬期講習）");
    expect(n.body).toBe(
      "締切は 12/10（木）です。まだの人は提出してください。提出済みの人はそのままで大丈夫です。",
    );
    expect(n.href).toBe("/tutor/training");
    expect(n.dedupKey).toBe("course-eve:p1");
  });

  it("レギュラー: 締切の時刻まで出す", () => {
    const n = regularEveNotice({
      id: "r1",
      label: "2027年1-3月",
      submissionDueAt: at("2026-12-12T23:59:00+09:00"),
    });
    expect(n.title).toBe("レギュラーシフトの締切は明日です（2027年1-3月）");
    expect(n.body.startsWith("締切は 12/12（土）23:59です。")).toBe(true);
    expect(n.href).toBe("/tutor/fixed-shifts");
    expect(n.dedupKey).toBe("regular-eve:r1");
  });
});
