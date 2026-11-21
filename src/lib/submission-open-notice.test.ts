import { describe, expect, it } from "vitest";
import {
  courseOpenNotice,
  isRegularOpenDue,
  regularOpenNotice,
} from "./submission-open-notice";

describe("courseOpenNotice", () => {
  it("講習名と締切日 (JST) を出す", () => {
    const n = courseOpenNotice({
      id: "p1",
      name: "2026年 冬期講習",
      // 12/10 の終わり (JST) = 12/10 14:59:59.999Z
      submissionDeadline: new Date("2026-12-10T23:59:59.999+09:00"),
    });
    expect(n.title).toBe("講習のシフト希望の提出が始まりました（2026年 冬期講習）");
    expect(n.body).toBe("締切は 12/10（木）です。");
    expect(n.href).toBe("/tutor/training");
    expect(n.dedupKey).toBe("course-open:p1");
  });

  it("締切が無くても送れる", () => {
    expect(
      courseOpenNotice({ id: "p1", name: "春期講習", submissionDeadline: null })
        .body,
    ).toBe("早めに提出してください。");
  });
});

describe("regularOpenNotice", () => {
  it("期の名前と締切日時 (JST) を出す", () => {
    const n = regularOpenNotice({
      id: "r1",
      label: "2027年春期 (4-6月)",
      submissionDueAt: new Date("2027-03-01T15:00:00Z"), // JST 3/2 0:00
    });
    expect(n.title).toBe("レギュラーシフトの提出が始まりました（2027年春期 (4-6月)）");
    expect(n.body).toBe("締切は 3/2（火）00:00です。");
    expect(n.href).toBe("/tutor/fixed-shifts");
    expect(n.dedupKey).toBe("regular-open:r1");
  });
});

describe("isRegularOpenDue", () => {
  const at = (s: string) => new Date(s);
  const base = {
    submissionOpensAt: at("2026-12-01T00:00:00+09:00"),
    submissionDueAt: at("2026-12-15T23:59:00+09:00"),
    createdAt: at("2026-11-20T10:00:00+09:00"),
  };

  it("受付開始前は送らない", () => {
    expect(isRegularOpenDue(base, at("2026-11-30T23:59:00+09:00"))).toBe(false);
  });

  it("受付開始日時を過ぎたら送る", () => {
    expect(isRegularOpenDue(base, at("2026-12-01T00:05:00+09:00"))).toBe(true);
  });

  it("締切を過ぎたら送らない", () => {
    expect(isRegularOpenDue(base, at("2026-12-16T00:00:00+09:00"))).toBe(false);
  });

  it("開始から 2 日を過ぎて初めて気づいたものは送らない (機能を入れる前から受付中の期)", () => {
    expect(isRegularOpenDue(base, at("2026-12-03T00:05:00+09:00"))).toBe(false);
  });

  it("開始日時を過去にして作った期は、作った時点から数える", () => {
    expect(
      isRegularOpenDue(
        { ...base, createdAt: at("2026-12-05T09:00:00+09:00") },
        at("2026-12-05T09:05:00+09:00"),
      ),
    ).toBe(true);
  });
});
