import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toFailedResult } from "@/lib/action-failure";

describe("toFailedResult", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reject を { ok: false } に畳む", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = toFailedResult(new Error("boom"));

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("診断のために元のエラーを console に残す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("boom");

    toFailedResult(cause);

    expect(spy).toHaveBeenCalledWith("server action failed:", cause);
  });

  it("原因を断定しない (#184 の方針)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // 実際の障害はサーバー側のことが多く、「通信状況を確認してください」と
    // 書くと誤った自己解決を促し、障害が報告されないまま埋もれる。
    expect(toFailedResult(new Error("x")).error).not.toMatch(/通信状況/);
  });

  it("操作の種類を固定しない (保存 / 承認 / 申請 / 取消 で使い回す)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(toFailedResult(new Error("x")).error).not.toMatch(/保存|承認|申請/);
  });
});

/** src 配下の .tsx を全部読む */
function tsxFiles(dir: string): { path: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    if (!entry.name.endsWith(".tsx")) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

describe("server action の reject が握り潰されていないこと (#202)", () => {
  // ⚠️ 普通のユニットテストでは押さえられない不変条件なのでソースを走査する。
  // vitest は node 環境 (jsdom 無し) でパネルを描画できず、かつ守りたいのは
  // 「**すべての**パネルが捕まえていること」というリポジトリ横断の性質。
  //
  // これが無いと、新しいパネルを足した人が同じ穴を開けても CI は緑のまま、
  // 障害時にそのパネルだけ「押しても何も起きない」に戻る。
  it("startTransition で action を呼ぶファイルは必ず toFailedResult を使う", () => {
    const offenders = tsxFiles("src/app")
      .filter(({ source }) => source.includes("startTransition(async"))
      .filter(({ source }) => !source.includes("toFailedResult"))
      .map(({ path }) => path);

    expect(offenders, [
      "server action の reject が捕まっていません。",
      "`await fn()` を `await fn().catch(toFailedResult)` にしてください。",
      "捕まえないと React 19 の Action の例外として error.tsx まで飛び、",
      "ページ全体が差し替わって入力途中の内容ごと消えます (#202)。",
    ].join("\n")).toEqual([]);
  });

  it("走査対象が実際に存在する (テスト自体が空振りしていないこと)", () => {
    // パスやパターンがずれると offenders が常に空になり、上のテストが
    // 何も守らないまま緑になる。
    const scanned = tsxFiles("src/app").filter(({ source }) =>
      source.includes("startTransition(async"),
    );

    expect(scanned.length).toBeGreaterThanOrEqual(13);
  });
});
