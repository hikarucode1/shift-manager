/**
 * アプリが使う DB の接続先を決める。
 *
 * Vercel の環境変数 (DATABASE_URL など) は Supabase 連携が入れたもので、
 * Production と Preview の両方に付いたまま外せない。そのままだと、まだマージ
 * していない PR のプレビューが本番 DB を読み書きしてしまう。
 * そこでプレビュー (VERCEL_ENV=preview) では本番の DATABASE_URL を使わない。
 * - PREVIEW_DATABASE_URL があればそれを使う (プレビュー専用 DB を作ったとき用)
 * - 無ければ、決して名前解決できない .invalid ホストを返し、クエリは失敗させる
 *   (ビルドは通し、画面を開いたときだけエラーにする)
 *
 * tsx スクリプトや Drizzle CLI からも import されるので server-only は付けない。
 */
export const PREVIEW_BLOCKED_DATABASE_URL =
  "postgres://preview-db-disabled.invalid:5432/none";

type Env = Record<string, string | undefined>;

export function isVercelPreview(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  if (isVercelPreview(env)) {
    return env.PREVIEW_DATABASE_URL || PREVIEW_BLOCKED_DATABASE_URL;
  }
  return env.DATABASE_URL;
}
