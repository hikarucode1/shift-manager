import { describe, expect, it } from "vitest";
import {
  firstSlotOfDay,
  isReminderDue,
  parseShiftReminderHours,
  reminderMessage,
} from "./shift-reminder-rule";

/** JST の時刻で Date を作る */
const jst = (s: string) => new Date(`${s}+09:00`);

describe("parseShiftReminderHours", () => {
  it("1〜3 と null だけ通す", () => {
    expect(parseShiftReminderHours(null)).toEqual({ ok: true, hours: null });
    expect(parseShiftReminderHours(2)).toEqual({ ok: true, hours: 2 });
    expect(parseShiftReminderHours(0)).toEqual({ ok: false });
    expect(parseShiftReminderHours(4)).toEqual({ ok: false });
    expect(parseShiftReminderHours("2")).toEqual({ ok: false });
    expect(parseShiftReminderHours(undefined)).toEqual({ ok: false });
  });
});

describe("isReminderDue", () => {
  const base = { date: "2026-11-24", startTime: "17:00", hours: 2 };

  it("2 時間前になる前は送らない", () => {
    expect(isReminderDue({ ...base, now: jst("2026-11-24T14:59:00") })).toBe(false);
  });

  it("2 時間前ちょうどから送る", () => {
    expect(isReminderDue({ ...base, now: jst("2026-11-24T15:00:00") })).toBe(true);
  });

  it("呼ばれ損ねても、開始前ならあとから送る", () => {
    expect(isReminderDue({ ...base, now: jst("2026-11-24T16:40:00") })).toBe(true);
  });

  it("開始時刻を過ぎたら送らない", () => {
    expect(isReminderDue({ ...base, now: jst("2026-11-24T17:00:00") })).toBe(false);
  });

  it("開始時刻の形が変なら送らない", () => {
    expect(
      isReminderDue({ ...base, startTime: "", now: jst("2026-11-24T16:00:00") }),
    ).toBe(false);
  });

  it("朝早いコマで日をまたぐ (前日の夜に送る)", () => {
    expect(
      isReminderDue({
        date: "2026-11-24",
        startTime: "01:00",
        hours: 3,
        now: jst("2026-11-23T22:30:00"),
      }),
    ).toBe(true);
  });
});

describe("firstSlotOfDay", () => {
  it("一番早いコマを返し、時刻の分からないコマは無視する", () => {
    expect(
      firstSlotOfDay([
        { n: 3, startTime: "19:00" },
        { n: 9, startTime: "" },
        { n: 2, startTime: "17:30" },
      ]),
    ).toEqual({ n: 2, startTime: "17:30" });
    expect(firstSlotOfDay([{ startTime: "" }])).toBeNull();
    expect(firstSlotOfDay([])).toBeNull();
  });
});

describe("reminderMessage", () => {
  it("開始時刻とコマ数を出す", () => {
    expect(
      reminderMessage({ startTime: "17:00", label: "2限", slotCount: 3 }),
    ).toEqual({
      title: "今日は 17:00 から出勤です",
      body: "2限から、今日は 3 コマです。",
    });
  });
});
