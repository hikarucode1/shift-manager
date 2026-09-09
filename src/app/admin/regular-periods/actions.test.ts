import { afterEach, describe, expect, it, vi } from "vitest";

// `@/lib/auth` / `@/db/client` を差し替えてから action を動的 import する
// (src/app/tutor/notifications/actions.test.ts と同じ形)。
const requireRole = vi.fn(async () => ({ profile: { id: "admin-1" } }));
vi.mock("@/lib/auth", () => ({ requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const returning = vi.fn(async () => [{ id: "period-1" }]);
const tx = {
  execute: vi.fn(async () => undefined),
  update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
};
const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
  fn(tx),
);
vi.mock("@/db/client", () => ({ db: { transaction } }));

const { updateRegularPeriod } = await import(
  "@/app/admin/regular-periods/actions"
);

/** 締切が期の終了日 (2026-03-31) の 23:00 JST に収まる、通るはずの入力 */
const base = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "2026 年度 1 期",
  startDate: "2026-03-01",
  endDate: "2026-03-31",
  submissionOpensAt: "2026-03-01T00:00:00.000Z",
  submissionDueAt: "2026-03-31T14:00:00.000Z", // = 3/31 23:00 JST
};

/** drizzle(postgres-js) のラップ構造を模す */
const pgError = (code: string, constraintName?: string) => ({
  name: "DrizzleQueryError",
  message: "Failed query: ...",
  cause: constraintName
    ? { code, constraint_name: constraintName }
    : { code, message: "period range does not cover child rows" },
});

afterEach(() => {
  vi.restoreAllMocks();
  transaction.mockReset();
  transaction.mockImplementation(async (fn) => fn(tx));
  returning.mockReset();
  returning.mockImplementation(async () => [{ id: "period-1" }]);
});

describe("updateRegularPeriod の締切バリデーション (#221)", () => {
  it("締切が期間内なら DB まで届く", async () => {
    await expect(updateRegularPeriod(base)).resolves.toEqual({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("締切が終了日より後なら DB に届く前に弾く", async () => {
    const r = await updateRegularPeriod({
      ...base,
      submissionDueAt: "2026-04-01T14:00:00.000Z",
    });
    expect(r).toEqual({
      ok: false,
      error: "提出締切は期の終了日までにしてください。",
    });
    // ⚠️ **ここが本体**。DB まで行くと 23514 になり、原因と無関係な
    // 「範囲外の確定枠を削除しろ」に化ける (#221)
    expect(transaction).not.toHaveBeenCalled();
  });

  it("JST で判定する — UTC のままだと通ってしまう境界", async () => {
    // 2026-03-31T15:30:00Z = 4/1 00:30 JST。UTC 日付 (3/31) で比べると通るが、
    // DB の CHECK は AT TIME ZONE 'Asia/Tokyo' なので落ちる
    const r = await updateRegularPeriod({
      ...base,
      submissionDueAt: "2026-03-31T15:30:00.000Z",
    });
    expect(r).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("締切が空でも 500 にせず、形式の文言を返す", async () => {
    // ⚠️ 回帰テスト。フィールド級の refine が落ちても zod はオブジェクト級の
    // refine を実行するので、`new Date("")` を `jstDateOf` に渡すと
    // toISOString() が RangeError を投げ、safeParse を素通りして server action
    // ごと 500 になっていた。編集行の datetime-local に required が無いので、
    // 締切を空にして保存すれば踏める
    const r = await updateRegularPeriod({ ...base, submissionDueAt: "" });
    expect(r).toEqual({
      ok: false,
      error: "日時の形式が正しくありません。",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("締切が終了日ちょうど (JST) は通る", async () => {
    const r = await updateRegularPeriod({
      ...base,
      submissionDueAt: "2026-03-31T14:59:59.000Z", // 3/31 23:59:59 JST
    });
    expect(r).toEqual({ ok: true });
  });
});

describe("updateRegularPeriod の 23514 の帰属 (#221)", () => {
  it("CHECK 由来なら締切の文言を出す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    transaction.mockRejectedValueOnce(
      pgError("23514", "regular_shift_periods_due_within_period_chk"),
    );
    await expect(updateRegularPeriod(base)).resolves.toEqual({
      ok: false,
      error: "提出締切は期の終了日までにしてください。",
    });
  });

  it("制約名が取れない (trigger 由来) なら 2 経路を併記する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    transaction.mockRejectedValueOnce(pgError("23514"));
    const r = await updateRegularPeriod(base);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("レギュラー確定枠");
    expect((r as { error: string }).error).toContain("提出締切");
  });

  it("23514 以外は汎用の文言", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    transaction.mockRejectedValueOnce(pgError("23503"));
    await expect(updateRegularPeriod(base)).resolves.toEqual({
      ok: false,
      error: "更新に失敗しました。",
    });
  });
});
