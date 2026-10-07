import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { isStale } from "@/lib/action-failure";
import {
  acceptanceRefusal,
  ALREADY_ACCEPTED,
  collectAllPages,
  emailInUseMessage,
  inviteErrorMessage,
  inviteStatusOf,
  mailTargetRefusal,
  normalizeEmail,
  NOT_YET_ACCEPTED,
  resendErrorMessage,
  resendFailure,
  resetErrorMessage,
  sameEmail,
} from "@/lib/invite-resend";

/**
 * エラーは自分で `new` せず、本物の auth-js に応答を流して作る
 * (invite-link.test.ts と同じ方針)。resendInvite / sendPasswordReset が
 * 受け取るのと同じ `inviteUserByEmail` / `resetPasswordForEmail` の経路を通す。
 */
function clientRespondingWith(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return createClient("http://auth.test", "service-key", {
    global: {
      fetch: async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json", ...headers },
        }),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function inviteError(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  const client = clientRespondingWith(status, body, headers);
  const { error } = await client.auth.admin.inviteUserByEmail("t@example.com");
  expect(error).not.toBeNull();
  return error;
}

/** sendPasswordReset と同じく implicit (既定) のクライアントから呼ぶ */
async function resetError(status: number, body: unknown = {}) {
  const client = clientRespondingWith(status, body);
  const { error } = await client.auth.resetPasswordForEmail("t@example.com");
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

describe("mailTargetRefusal", () => {
  const ok = {
    roles: ["tutor"],
    authUserId: "00000000-0000-0000-0000-000000000001",
    isActive: true,
  };

  it("連携済みで有効な講師は断らない (兼任者も含む)", () => {
    expect(mailTargetRefusal(ok)).toBeNull();
    expect(mailTargetRefusal({ ...ok, roles: ["admin", "tutor"] })).toBeNull();
  });

  it("存在しない・講師でない・未連携・無効は断る", () => {
    expect(mailTargetRefusal(undefined)).toMatch("見つかりません");
    expect(mailTargetRefusal({ ...ok, roles: ["admin"] })).toMatch("講師以外");
    expect(mailTargetRefusal({ ...ok, authUserId: null })).toMatch("ログイン連携");
    expect(mailTargetRefusal({ ...ok, isActive: false })).toMatch("無効な講師");
  });
});

describe("acceptanceRefusal (#300)", () => {
  it("招待中への再送と、受け取り済みへの再設定メールは断らない", () => {
    expect(acceptanceRefusal("resend", false)).toBeNull();
    expect(acceptanceRefusal("reset", true)).toBeNull();
  });

  it("逆向きは断り、画面の状態が古い印を付ける (画面が読み直す)", () => {
    const resend = acceptanceRefusal("resend", true);
    expect(resend?.error).toBe(ALREADY_ACCEPTED);
    expect(resend && isStale(resend)).toBe(true);

    const reset = acceptanceRefusal("reset", false);
    expect(reset?.error).toBe(NOT_YET_ACCEPTED);
    expect(reset && isStale(reset)).toBe(true);
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

describe("resendFailure (#300)", () => {
  it("確認済みユーザーへの招待 (email_exists) は受け取り済みと伝え、画面の状態が古い印を付ける", async () => {
    const msg = "A user with this email address has already been registered";
    // 旧形式 (error_code) と、API バージョン付きの新形式 (code) の両方
    const legacy = await inviteError(422, { error_code: "email_exists", msg });
    const versioned = await inviteError(
      422,
      { code: "email_exists", msg },
      { "x-supabase-api-version": "2024-01-01" },
    );
    for (const error of [legacy, versioned]) {
      const res = resendFailure(error);
      expect(res.error).toBe(ALREADY_ACCEPTED);
      expect(isStale(res)).toBe(true);
    }
  });

  it("それ以外の失敗には印を付けない (読み直しても画面は変わらない)", async () => {
    for (const error of [
      await inviteError(429, { error_code: "over_email_send_rate_limit" }),
      await inviteError(503),
      null,
    ]) {
      const res = resendFailure(error);
      expect(res.error).toBe(resendErrorMessage(error));
      expect(isStale(res)).toBe(false);
    }
  });
});

describe("resetErrorMessage", () => {
  it("メール送信の上限 (429) は障害ではなく送りすぎとして伝える", async () => {
    const error = await resetError(429, {
      error_code: "over_email_send_rate_limit",
      msg: "For security purposes, you can only request this after 60 seconds.",
    });
    expect(resetErrorMessage(error)).toMatch("送りすぎ");
  });

  it("認証 API に届かないときは時間をおくよう伝える", async () => {
    expect(resetErrorMessage(await resetError(503))).toMatch(
      "現在再設定メールを送れません",
    );
  });

  it("それ以外は汎用の失敗文", async () => {
    expect(
      resetErrorMessage(
        await resetError(400, { error_code: "validation_failed", msg: "bad" }),
      ),
    ).toMatch("送れませんでした");
    expect(resetErrorMessage(null)).toMatch("送れませんでした");
  });
});

describe("normalizeEmail", () => {
  it("前後の空白を落として小文字にする", () => {
    expect(normalizeEmail("  Tutor@Example.COM ")).toBe("tutor@example.com");
  });
});

describe("emailInUseMessage", () => {
  it("誰のログインに使われているかを伝える", () => {
    expect(emailInUseMessage("山田")).toBe(
      "このメールアドレスは既に「山田」さんのログインに使われています。",
    );
  });
});

describe("inviteErrorMessage", () => {
  it("確認済みユーザーと同じメール (email_exists) は登録済みと伝える", async () => {
    const msg = "A user with this email address has already been registered";
    const legacy = await inviteError(422, { error_code: "email_exists", msg });
    const versioned = await inviteError(
      422,
      { code: "email_exists", msg },
      { "x-supabase-api-version": "2024-01-01" },
    );
    expect(inviteErrorMessage(legacy)).toMatch("既に登録されています");
    expect(inviteErrorMessage(versioned)).toMatch("既に登録されています");
  });

  it("メール送信の上限 (429) は送りすぎとして伝える", async () => {
    const error = await inviteError(429, {
      error_code: "over_email_send_rate_limit",
      msg: "email rate limit exceeded",
    });
    expect(inviteErrorMessage(error)).toMatch("送りすぎ");
  });

  it("認証 API の障害はメールアドレスのせいにしない (#269)", async () => {
    for (const error of [
      await inviteError(503),
      await inviteError(500, {
        error_code: "unexpected_failure",
        msg: "Database error saving new user",
      }),
    ]) {
      const message = inviteErrorMessage(error);
      expect(message).toMatch("現在招待を送れません");
      expect(message).not.toMatch("メールアドレスを確認");
    }
  });

  it("error_code の無い 429 (プロキシなど) も送りすぎとして伝える", async () => {
    const error = await inviteError(429, { message: "Too Many Requests" });
    expect(inviteErrorMessage(error)).toMatch("送りすぎ");
  });

  it("送信設定の問題はメールアドレスのせいにしない", async () => {
    const error = await inviteError(400, {
      error_code: "email_address_not_authorized",
      msg: "Email address not authorized",
    });
    const message = inviteErrorMessage(error);
    expect(message).toMatch("送信設定");
    expect(message).not.toMatch("メールアドレスを確認");
  });

  it("メッセージの文言ではなく code で分ける", async () => {
    // 旧実装は /rate|limit|too many/ と /already|registered|exists/ で誤分類した
    const error = await inviteError(400, {
      error_code: "email_address_invalid",
      msg: "Email address exists but is invalid: rate limit",
    });
    expect(inviteErrorMessage(error)).toMatch("メールアドレスを確認");
  });
});

describe("collectAllPages (#271)", () => {
  /** pages[i] が i+1 ページ目に返る中身。範囲外は空 */
  const pager = (pages: number[][]) => {
    const calls: number[] = [];
    const fetchPage = async (page: number) => {
      calls.push(page);
      return pages[page - 1] ?? [];
    };
    return { fetchPage, calls };
  };

  it("空のページが返るまで読み進める (1 ページの件数が少なく抑えられていても)", async () => {
    // 1000 件頼んだのに 2 件ずつしか返らない場合でも、取りこぼさない
    const { fetchPage, calls } = pager([[1, 2], [3, 4], [5]]);
    expect(await collectAllPages(fetchPage)).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual([1, 2, 3, 4]);
  });

  it("1 ページで全部なら、空のページを 1 回読んで止まる", async () => {
    const { fetchPage, calls } = pager([[1, 2, 3]]);
    expect(await collectAllPages(fetchPage)).toEqual([1, 2, 3]);
    expect(calls).toEqual([1, 2]);
  });

  it("途中で読み込みに失敗したら全体を null にする", async () => {
    const fetchPage = async (page: number) => (page === 2 ? null : [page]);
    expect(await collectAllPages(fetchPage)).toBeNull();
  });

  it("上限を超えたら null (一部だけを全部として返さない)", async () => {
    const fetchPage = async (page: number) => [page];
    expect(await collectAllPages(fetchPage, 3)).toBeNull();
  });

  it("ちょうど上限のページ数なら、終わりを確かめる空のページは上限に数えない", async () => {
    const { fetchPage, calls } = pager([[1], [2], [3]]);
    expect(await collectAllPages(fetchPage, 3)).toEqual([1, 2, 3]);
    expect(calls).toEqual([1, 2, 3, 4]);
  });
});
