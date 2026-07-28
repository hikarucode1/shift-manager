import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// .env.local を優先、無ければ .env を読む
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // #165: migrate は direct connection (5432) を使う。DATABASE_URL は
    // transaction pooler (6543) を指しており、drizzle-kit migrate が
    // pooler 経由だと half-applied で失敗する (docs/migration-policy.md 参照)。
    // DIRECT_URL があればそれを優先し、無ければ従来どおり DATABASE_URL。
    // ?? ではなく trim()+|| を使う: .env.local.example は DIRECT_URL= (空) を
    // 配っており、dotenv は空文字を注入するため ?? だと "" のまま渡ってしまう。
    url: process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
