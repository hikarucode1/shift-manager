import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import {
  expireAuthCookies,
  isSupabaseAuthCookie,
} from "@/lib/supabase/auth-cookies";

describe("isSupabaseAuthCookie", () => {
  it.each([
    "sb-abcdefg-auth-token",
    "sb-abcdefg-auth-token.0",
    "sb-abcdefg-auth-token.12",
    "sb-abcdefg-auth-token-code-verifier",
    "sb-abcdefg-auth-token-user",
  ])("認証 cookie として拾う: %s", (name) => {
    expect(isSupabaseAuthCookie(name)).toBe(true);
  });

  it.each(["theme", "sb-provider-token", "auth-token", "sb-abcdefg-other"])(
    "拾わない: %s",
    (name) => {
      expect(isSupabaseAuthCookie(name)).toBe(false);
    },
  );
});

describe("expireAuthCookies", () => {
  function expire(cookieHeader: string) {
    const request = new Request("https://example.test/", {
      headers: { cookie: cookieHeader },
    });
    const response = NextResponse.next();
    expireAuthCookies(request, response);
    return response.headers.getSetCookie();
  }

  it("Expires を過去にして消す", () => {
    // ⚠️ Max-Age だけでは足りない。auth-js も同じ名前を消しに来る場面では
    // Next のマージで Max-Age=0 が落ち、属性の無い空 cookie = セッション
    // cookie になってブラウザに残る (実測)。Expires はマージを越える。
    const [header] = expire("sb-abcdefg-auth-token=v");

    expect(header).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(header).toContain("Path=/");
  });

  it("認証と無関係な cookie には触らない", () => {
    expect(expire("theme=dark; sb-provider-token=keep")).toEqual([]);
  });

  it("cookie が無くても壊れない", () => {
    expect(expire("")).toEqual([]);
  });
});
