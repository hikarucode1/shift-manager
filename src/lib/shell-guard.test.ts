import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notFound, redirect } from "next/navigation";
import { resolveOrIncident } from "@/lib/shell-guard";

/** 実際に Next が投げる制御フロー例外を捕まえて返す (自作の偽物では意味がない) */
function controlFlowErrorFrom(fn: () => never): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("制御フロー例外が投げられなかった");
}

describe("resolveOrIncident", () => {
  beforeEach(() => {
    // reportIncident が console.error するのでテスト出力を汚さない
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成功したら値をそのまま返す", async () => {
    const result = await resolveOrIncident("test", async () => ({ id: "x" }));
    expect(result).toEqual({ ok: true, value: { id: "x" } });
  });

  it("DB エラーは握り潰して incidentId を返す", async () => {
    const result = await resolveOrIncident("test", async () => {
      throw new Error("connection refused");
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.incidentId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("incidentId は同じ値をサーバーログにも出す (問い合わせ時の突合用)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await resolveOrIncident("my-scope", async () => {
      throw new Error("boom");
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(spy).toHaveBeenCalledWith(
      `[my-scope] incident=${result.incidentId}`,
      expect.any(Error),
    );
  });

  // --- ここから下が security-critical ---
  // 握り潰すと権限不足の redirect が効かなくなり、権限バイパスになる。

  it("redirect() は握り潰さず再 throw する", async () => {
    const redirectError = controlFlowErrorFrom(() => redirect("/login"));

    await expect(
      resolveOrIncident("test", async () => {
        throw redirectError;
      }),
    ).rejects.toBe(redirectError);
  });

  it("notFound() も再 throw する", async () => {
    const notFoundError = controlFlowErrorFrom(() => notFound());

    await expect(
      resolveOrIncident("test", async () => {
        throw notFoundError;
      }),
    ).rejects.toBe(notFoundError);
  });

  it("cause に包まれた redirect() も再 throw する (包みを剥がして投げ直す)", async () => {
    // drizzle は全クエリ例外を DrizzleQueryError で包む。包まれると表層に
    // digest が無くなるので、digest 文字列を自前で見る判定では素通りする。
    const inner = controlFlowErrorFrom(() => redirect("/login"));
    const wrapped = new Error("DrizzleQueryError", { cause: inner });

    // 投げ直されるのは wrapper ではなく **中身** の方。Next は digest を見て
    // リダイレクトを実行するので、包んだままでは digest が読めず機能しない。
    await expect(
      resolveOrIncident("test", async () => {
        throw wrapped;
      }),
    ).rejects.toBe(inner);
    expect((inner as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT/);
  });

  it("cause が普通のエラーなら握り潰す (再 throw しすぎていないこと)", async () => {
    const wrapped = new Error("DrizzleQueryError", {
      cause: new Error("ECONNREFUSED"),
    });

    const result = await resolveOrIncident("test", async () => {
      throw wrapped;
    });

    expect(result.ok).toBe(false);
  });
});
