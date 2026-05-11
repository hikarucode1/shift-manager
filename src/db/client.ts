import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";

// Next.js では自動で .env.local を読むが、スクリプト/CLI 実行時のフォールバック
if (!process.env.DATABASE_URL) {
  config({ path: ".env.local" });
  config({ path: ".env" });
}
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// Supabase の pooler(ポート 6543)経由のセッションは prepare を無効化
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export type Database = typeof db;
