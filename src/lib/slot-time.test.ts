import { describe, expect, it } from "vitest";
import { isSlotPast, jstTimeOfDay } from "@/lib/slot-time";

/** JST の指定時刻に相当する Date (JST = UTC+9、DST 無し) */
const jst = (iso: string) => new Date(`${iso}+09:00`);

describe("isSlotPast", () => {
  // ⚠️ この 1 件が #178 の本体。日付粒度のガードだと「今朝終わったコマを
  // 午後に交代」が素通りし、承認すると実施済みコマの担当が事後に書き換わる。
  it("同じ日でも、終了したコマは過去として扱う", () => {
    expect(isSlotPast("2026-08-21", "16:30", jst("2026-08-21T17:00"))).toBe(
      true,
    );
  });

  it("同じ日でも、まだ終わっていないコマは過去ではない", () => {
    expect(isSlotPast("2026-08-21", "16:30", jst("2026-08-21T16:29"))).toBe(
      false,
    );
  });

  it("終了時刻ちょうどは終了済み", () => {
    expect(isSlotPast("2026-08-21", "16:30", jst("2026-08-21T16:30"))).toBe(
      true,
    );
  });

  it("前日のコマは終了時刻に関わらず過去", () => {
    expect(isSlotPast("2026-08-20", "23:59", jst("2026-08-21T00:01"))).toBe(
      true,
    );
  });

  it("翌日のコマは過去ではない", () => {
    expect(isSlotPast("2026-08-22", "09:00", jst("2026-08-21T23:59"))).toBe(
      false,
    );
  });

  it("JST の日付境界で判定が変わる (サーバーの TZ に依存しない)", () => {
    // UTC では 8/20 15:30 = JST 8/21 00:30。JST の「今日」は 8/21。
    const justAfterJstMidnight = new Date("2026-08-20T15:30:00Z");

    expect(isSlotPast("2026-08-20", "20:00", justAfterJstMidnight)).toBe(true);
    expect(isSlotPast("2026-08-21", "20:00", justAfterJstMidnight)).toBe(false);
  });

  it("終了時刻が未設定なら、その日のうちは過去にしない", () => {
    // slot_definitions が未投入で DEFAULT_SLOTS にも無い番号のときの保険。
    // 判定できないものを「終了済み」と決めつけて操作を止めない。
    expect(isSlotPast("2026-08-21", "", jst("2026-08-21T23:59"))).toBe(false);
  });
});

describe("jstTimeOfDay", () => {
  it("コマ定義と同じ HH:MM 形式で返す", () => {
    expect(jstTimeOfDay(jst("2026-08-21T09:05"))).toBe("09:05");
  });

  it("UTC の日付をまたいでも JST の時刻になる", () => {
    expect(jstTimeOfDay(new Date("2026-08-20T15:30:00Z"))).toBe("00:30");
  });
});
