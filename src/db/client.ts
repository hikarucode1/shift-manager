import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Next.js は .env.local を自動で読むが、tsx スクリプトや Drizzle CLI から
// 直接 import されたときのフォールバック。
// 注意: dotenv は既存の env を上書きしないため、.env.local → .env の順で読む
// （.env.local を優先したい）。
if (!process.env.DATABASE_URL) {
  config({ path: ".env.local" });
  config({ path: ".env" });
}

const connectionString = process.env.DATABASE_URL!;

// Supabase の pooler(ポート 6543)経由のセッションは prepare を無効化。
// #165: プール上限を明示。デフォルト max:10 のままだと、サーバーレス
// (Vercel) の同時起動インスタンス × 10 で Supavisor の接続上限を食い潰しうる。
// 各インスタンスは小さめに抑える (pooler 側が実接続をプールする)。
// tx 中に別接続を要求する箇所は無い (transaction は tx 引数で完結) ため
// 小さい max でデッドロックしない。idle_timeout は idle 接続を早めに解放する。
// 注: connect_timeout は TCP+認証ハンドシェイクにのみ効き、プール枯渇時の
// キュー待ちには上限が無い (postgres-js に該当オプション無し)。max を超えた
// クエリは接続が空くまで待つ。
const client = postgres(connectionString, {
  prepare: false,
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
