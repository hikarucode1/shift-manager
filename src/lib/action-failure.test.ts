import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";

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

  it("結果不定の印を付ける (サーバーが書いたか分からない)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // action が { ok: false } を「返した」ときは確実に書いていないが、
    // reject は commit 済みでレスポンスだけ落ちた可能性がある。呼び出し側は
    // この印を見て router.refresh() し、サーバーの真実を取りに行く。
    expect(isIndeterminate(toFailedResult(new Error("x")))).toBe(true);
    expect(isIndeterminate({ ok: false, error: "過去の日付は…" })).toBe(false);
  });

  it("digest があればエラーID として文言に出す", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // production では server action の例外はメッセージがサニタイズされる
    // 代わりに digest を持つ。error.tsx が出していた値と同じなので、
    // 報告の導線をトースト粒度で引き継ぐ。
    const withDigest = Object.assign(new Error("boom"), { digest: "abc123" });

    expect(toFailedResult(withDigest).error).toContain("エラーID: abc123");
    expect(toFailedResult(new Error("boom")).error).not.toContain("エラーID");
  });

  it("操作の種類を固定しない (保存 / 承認 / 申請 / 取消 で使い回す)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(toFailedResult(new Error("x")).error).not.toMatch(/保存|承認|申請/);
  });
});

/** 指定ディレクトリ配下の .tsx を再帰的に読む */
function tsxFiles(dir: string): { path: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    if (!entry.name.endsWith(".tsx")) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

/** server action のモジュール (`./actions` `./confirm-actions` など) からの import 名 */
function importedActionNames(source: string): string[] {
  const names: string[] = [];
  const importRe = /import\s+\{([^}]+)\}\s+from\s+"[^"]*actions"/g;
  for (const m of source.matchAll(importRe)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && !name.startsWith("type ")) names.push(name);
    }
  }
  return names;
}

/**
 * `await name(...)` の呼び出しを探し、閉じ括弧の直後が `.catch(` でないものを返す。
 *
 * ファイル単位の文字列一致だと、**同じファイル内の一部の呼び出しだけ捕まえて
 * いれば緑**になる (3 箇所呼ぶファイルが 3 つある)。実際にミューテーションで
 * すり抜けたのでここまで見る。
 */
function uncaughtCalls(source: string, names: string[]): string[] {
  const uncaught: string[] = [];
  for (const name of names) {
    const callRe = new RegExp(`await\\s+${name}\\s*\\(`, "g");
    for (const m of source.matchAll(callRe)) {
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const c = source[i];
        if (c === "(") depth += 1;
        else if (c === ")") depth -= 1;
        i += 1;
      }
      if (!source.slice(i, i + 7).startsWith(".catch(")) uncaught.push(name);
    }
  }
  return uncaught;
}

const SRC = resolve(__dirname, "..");
const OPT_OUT = "action-failure: ok";

function panelFiles() {
  return [...tsxFiles(join(SRC, "app")), ...tsxFiles(join(SRC, "components"))]
    .map((f) => ({ ...f, names: importedActionNames(f.source) }))
    .filter((f) => f.names.length > 0);
}

describe("server action の reject が握り潰されていないこと (#202)", () => {
  // ⚠️ 普通のユニットテストでは押さえられない不変条件なのでソースを走査する。
  // vitest は node 環境 (jsdom 無し) でパネルを描画できず、かつ守りたいのは
  // 「**すべての**呼び出しが捕まえていること」というリポジトリ横断の性質。
  //
  // ⚠️ 起点は「server action を import しているか」。`startTransition(async` の
  // 文字列一致にしていたら、useTransition() の戻り値を startParse/startCommit に
  // 分割代入している upload-wizard.tsx を**実際に取りこぼした** (レビュー指摘)。
  // 呼び出し側の書き方ではなく import で捕まえる。
  //
  // 意図的に独自の catch を持つファイルは、理由を書いた opt-out で除外する。
  it("import した server action の呼び出しは必ず reject を捕まえる", () => {
    const offenders = panelFiles()
      .filter(({ source }) => !source.includes(OPT_OUT))
      .flatMap(({ path, source, names }) =>
        uncaughtCalls(source, names).map((n) => `${path} → ${n}()`),
      );

    expect(offenders, [
      "server action の reject が捕まっていません。",
      "`await fn(...)` を `await fn(...).catch(toFailedResult)` にしてください。",
      "捕まえないと React 19 の Action の例外として error.tsx まで飛び、",
      "ページ全体が差し替わって入力途中の内容ごと消えます (#202)。",
      `意図的に独自の catch を持つ場合は "${OPT_OUT}" と理由をコメントに書いてください。`,
    ].join("\n")).toEqual([]);
  });

  it("走査対象が実際に存在する (テスト自体が空振りしていないこと)", () => {
    // パスやパターンがずれると offenders が常に空になり、上のテストが
    // 何も守らないまま緑になる。
    const files = panelFiles();

    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.flatMap((f) => f.names).length).toBeGreaterThanOrEqual(20);
  });
});
