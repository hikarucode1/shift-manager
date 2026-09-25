import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  ALREADY_ACCEPTED,
  inviteStatusOf,
  resendErrorMessage,
  resendRefusal,
  sameEmail,
} from "@/lib/invite-resend";

/**
 * エラーは自分で `new` せず、本物の auth-js に応答を流して作る
 * (invite-link.test.ts と同じ方針)。resendInvite が受け取るのと同じ
 * `auth.admin.inviteUserByEmail` の経路を通す。
 */
async function inviteError(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  const client = createClient("http://auth.test", "service-key", {
    global: {
      fetch: async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json", ...headers },
        }),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.admin.inviteUserByEmail("t@example.com");
  expect(error).not.toBeNull();
  return error;
}

describe("inviteStatusOf", () => {
  it("確認日時が無ければ招待中", () => {
    expect(inviteStatusOf({ email_confirmed_at: undefined })).toBe("pending");
    expect(inviteStatusOf({ email_confirmed_at: null })).toBe("pending");
  });

  it("メールか電話が確認済みなら受け取り済み (GoTrue の IsConfirmed と同じ線)", () => {
    expect(inviteStatusOf({ email_confirmed_at: "2026-09-25T00:00:00Z" })).toBe(
      "accepted",
    );
    expect(inviteStatusOf({ phone_confirmed_at: "2026-09-25T00:00:00Z" })).toBe(
      "accepted",
    );
  });

  it("auth ユーザーが見つからなければ不明", () => {
    expect(inviteStatusOf(undefined)).toBe("unknown");
  });
});

describe("resendRefusal", () => {
  const ok = {
    roles: ["tutor"],
    authUserId: "00000000-0000-0000-0000-000000000001",
    isActive: true,
  };

  it("連携済みで有効な講師は断らない (兼任者も含む)", () => {
    expect(resendRefusal(ok)).toBeNull();
    expect(resendRefusal({ ...ok, roles: ["admin", "tutor"] })).toBeNull();
  });

  it("存在しない・講師でない・未連携・無効は断る", () => {
    expect(resendRefusal(undefined)).toMatch("見つかりません");
    expect(resendRefusal({ ...ok, roles: ["admin"] })).toMatch("講師以外");
    expect(resendRefusal({ ...ok, authUserId: null })).toMatch("ログイン連携");
    expect(resendRefusal({ ...ok, isActive: false })).toMatch("無効な講師");
  });
});

describe("sameEmail", () => {
  it("大文字小文字と前後の空白は区別しない", () => {
    expect(sameEmail("tutor@example.com", " Tutor@Example.com ")).toBe(true);
  });

  it("違う宛先は一致としない", () => {
    expect(sameEmail("a@example.com", "b@example.com")).toBe(false);
  });
});

describe("resendErrorMessage", () => {
  it("確認済みユーザーへの招待 (email_exists) は受け取り済みと伝える", async () => {
    const msg = "A user with this email address has already been registered";
    // 旧形式 (error_code) と、API バージョン付きの新形式 (code) の両方
    const legacy = await inviteError(422, { error_code: "email_exists", msg });
    const versioned = await inviteError(
      422,
      { code: "email_exists", msg },
      { "x-supabase-api-version": "2024-01-01" },
    );
    expect(resendErrorMessage(legacy)).toBe(ALREADY_ACCEPTED);
    expect(resendErrorMessage(versioned)).toBe(ALREADY_ACCEPTED);
  });

  it("メール送信の上限 (429) は障害ではなく送りすぎとして伝える", async () => {
    const error = await inviteError(429, {
      error_code: "over_email_send_rate_limit",
      msg: "email rate limit exceeded",
    });
    expect(resendErrorMessage(error)).toMatch("送りすぎ");
  });

  it("認証 API に届かないときは時間をおくよう伝える", async () => {
    expect(resendErrorMessage(await inviteError(503))).toMatch(
      "現在招待を送れません",
    );
    expect(
      resendErrorMessage(
        await inviteError(500, { error_code: "unexpected_failure" }),
      ),
    ).toMatch("現在招待を送れません");
  });

  it("それ以外は汎用の失敗文", async () => {
    expect(
      resendErrorMessage(
        await inviteError(400, { error_code: "validation_failed", msg: "bad" }),
      ),
    ).toMatch("再送できませんでした");
    expect(resendErrorMessage(null)).toMatch("再送できませんでした");
  });
});
