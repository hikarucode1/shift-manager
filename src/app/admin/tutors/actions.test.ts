import { afterEach, describe, expect, it, vi } from "vitest";

// `@/lib/auth` / `@/db/client` / 管理用クライアントを差し替えてから action を
// 動的 import する (regular-periods/actions.test.ts と同じ形)。
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(async () => ({ profile: { id: "admin-1" } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * `db.select().from().where().limit()` の結果を、呼ばれた順に返す。
 * inviteTutor (new) の select は 同名講師 → メールの事前確認 → 巻き戻しの持ち主確認 の順。
 */
const selectResults: Array<() => Promise<unknown[]>> = [];
const limit = vi.fn(() => {
  const next = selectResults.shift();
  if (!next) throw new Error("unexpected select");
  return next();
});
const insertValues = vi.fn(async (): Promise<unknown> => undefined);
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    insert: () => ({ values: insertValues }),
  },
}));

const inviteUserByEmail = vi.fn(async () => ({
  data: { user: { id: "auth-a" } },
  error: null,
}));
const deleteUser = vi.fn(async () => ({ data: {}, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { inviteUserByEmail, deleteUser } },
  }),
}));

const { inviteTutor } = await import("@/app/admin/tutors/actions");

const input = { mode: "new", email: "a@example.com", displayName: "新人" };

/** profiles_auth_user_id_unique に当たったときの drizzle(postgres-js) の形 */
const uniqueViolation = {
  name: "DrizzleQueryError",
  message: "Failed query: ...",
  cause: { code: "23505", constraint_name: "profiles_auth_user_id_unique" },
};

afterEach(() => {
  selectResults.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("inviteTutor: 同じメールの講師がいるとき (#272)", () => {
  it("連携済みの講師が同じメールを使っていれば、GoTrue を呼ぶ前に断る", async () => {
    selectResults.push(
      async () => [], // 同名講師なし
      async () => [{ displayName: "既存" }], // メールの事前確認
    );
    const r = await inviteTutor(input);
    expect(r).toEqual({
      ok: false,
      error: "このメールアドレスは既に「既存」さんのログインに使われています。",
    });
    // ⚠️ ここが本体。呼ぶと既存講師の招待リンクが無効になる
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("事前確認をすり抜けても、他の講師に紐付いた auth ユーザーは消さない", async () => {
    selectResults.push(
      async () => [],
      async () => [], // profiles.email がずれていて事前確認は素通り
      async () => [{ id: "profile-a", displayName: "既存" }], // 持ち主がいる
    );
    insertValues.mockRejectedValueOnce(uniqueViolation);
    const r = await inviteTutor(input);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch("送り直されたため");
  });

  it("持ち主を確かめられないときも消さない", async () => {
    selectResults.push(
      async () => [],
      async () => [],
      async () => {
        throw new Error("db down");
      },
    );
    insertValues.mockRejectedValueOnce(new Error("insert failed"));
    const r = await inviteTutor(input);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false });
  });

  it("誰にも紐付いていなければ、従来どおり巻き戻して消す (孤児防止)", async () => {
    selectResults.push(
      async () => [],
      async () => [],
      async () => [], // 持ち主なし
    );
    insertValues.mockRejectedValueOnce(new Error("insert failed"));
    const r = await inviteTutor(input);
    expect(deleteUser).toHaveBeenCalledWith("auth-a");
    expect(r).toMatchObject({ ok: false });
  });

  it("書き込みが通れば巻き戻さない", async () => {
    selectResults.push(async () => [], async () => []);
    await expect(inviteTutor(input)).resolves.toEqual({ ok: true });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
