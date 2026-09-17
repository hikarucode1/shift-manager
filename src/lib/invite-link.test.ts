import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  classifyVerifyError,
  parseInviteLink,
  passwordUpdateErrorMessage,
  validateNewPassword,
} from "@/lib/invite-link";

/**
 * エラーは自分で `new` せず、**本物の auth-js に応答を流して作る**
 * (auth-availability.test.ts と同じ方針)。特に weak_password は auth-js が
 * `AuthApiError` ではなく `AuthWeakPasswordError` に作り替えるので、
 * 手で作ると本番と違う形を通してしまう。
 *
 * updateUser のエラーも verifyOtp で作っている。どちらも同じ `_request` →
 * `handleError` を通るので、応答 → エラーの変換は同一。
 */
function clientRespondingWith(respond: () => Promise<Response>) {
  return createClient("http://auth.test", "anon-key", {
    global: { fetch: respond },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const respondWith =
  (status: number, body: unknown = {}) =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

async function verifyError(respond: () => Promise<Response>) {
  const { error } = await clientRespondingWith(respond).auth.verifyOtp({
    type: "invite",
    token_hash: "hash",
  });
  expect(error).not.toBeNull();
  return error;
}

describe("parseInviteLink", () => {
  it("type=invite と token_hash があれば通す", () => {
    expect(parseInviteLink({ token_hash: "abc", type: "invite" })).toEqual({
      tokenHash: "abc",
      type: "invite",
    });
  });

  it.each([
    ["recovery", { token_hash: "abc", type: "recovery" }],
    ["magiclink", { token_hash: "abc", type: "magiclink" }],
    ["type なし", { token_hash: "abc" }],
    ["token_hash なし", { type: "invite" }],
    ["token_hash が空白", { token_hash: "  ", type: "invite" }],
    // searchParams は同名キーが複数あると配列になる
    ["token_hash が配列", { token_hash: ["a", "b"], type: "invite" }],
  ])("%s は弾く", (_, params) => {
    expect(parseInviteLink(params)).toBeNull();
  });
});

describe("classifyVerifyError", () => {
  it.each([
    [
      "期限切れ",
      respondWith(403, {
        error_code: "otp_expired",
        msg: "Email link is invalid or has expired",
      }),
    ],
    ["使用済み・不正なリンク", respondWith(404, { error_code: "not_found" })],
  ])("%s は invalid (押し直しても通らない)", async (_, respond) => {
    expect(classifyVerifyError(await verifyError(respond))).toBe("invalid");
  });

  it.each([
    [
      "fetch 自体の失敗",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["503", respondWith(503)],
    ["429", respondWith(429, { error_code: "over_request_rate_limit" })],
  ])("%s は unavailable (リンクはまだ使える)", async (_, respond) => {
    expect(classifyVerifyError(await verifyError(respond))).toBe(
      "unavailable",
    );
  });
});

describe("validateNewPassword", () => {
  it("8 文字以上で確認と一致すれば通す", () => {
    expect(validateNewPassword("abcd1234", "abcd1234")).toBeNull();
  });

  it("7 文字は弾く", () => {
    expect(validateNewPassword("abcd123", "abcd123")).toMatch(/8文字以上/);
  });

  it("確認と一致しなければ弾く", () => {
    expect(validateNewPassword("abcd1234", "abcd1235")).toMatch(/一致しません/);
  });

  it("72 バイトを超えたら弾く (文字数ではなくバイト数で数える)", () => {
    // 全角 25 文字 = 75 バイト。文字数で数えると通ってしまう
    const long = "あ".repeat(25);
    expect(validateNewPassword(long, long)).toMatch(/長すぎます/);
    const ok = "a".repeat(72);
    expect(validateNewPassword(ok, ok)).toBeNull();
  });
});

describe("passwordUpdateErrorMessage", () => {
  it("weak_password (AuthWeakPasswordError) を拾う", async () => {
    const error = await verifyError(
      respondWith(422, {
        error_code: "weak_password",
        msg: "Password is known to be weak",
        weak_password: { reasons: ["pwned"] },
      }),
    );
    expect(error?.name).toBe("AuthWeakPasswordError");
    expect(passwordUpdateErrorMessage(error)).toMatch(/推測されやすい/);
  });

  it("same_password を拾う", async () => {
    const error = await verifyError(
      respondWith(422, { error_code: "same_password" }),
    );
    expect(passwordUpdateErrorMessage(error)).toMatch(/今と同じ/);
  });

  it("セッションが無ければ再送を案内する", async () => {
    const { error } = await clientRespondingWith(
      respondWith(200),
    ).auth.updateUser({ password: "abcd1234" });
    expect(error?.name).toBe("AuthSessionMissingError");
    expect(passwordUpdateErrorMessage(error)).toMatch(/再送/);
  });

  it("到達不能は『保存できません』で、再送は案内しない", async () => {
    const error = await verifyError(respondWith(503));
    const message = passwordUpdateErrorMessage(error);
    expect(message).toMatch(/現在パスワードを保存できません/);
    expect(message).not.toMatch(/再送/);
  });

  it("分類できないものは汎用の文にする", async () => {
    const error = await verifyError(
      respondWith(400, { error_code: "validation_failed" }),
    );
    expect(passwordUpdateErrorMessage(error)).toMatch(/保存できませんでした/);
  });
});
