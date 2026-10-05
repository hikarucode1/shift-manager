import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // ⚠️ 本番 (Vercel) と同じ UTC に固定する (#279)。開発機は JST なので、
    // 固定しないと「JST の暦で数えているか」のテストが古い実装でも通ってしまう。
    // ⚠️ **`env.TZ` が効くのは forks (子プロセス) だけ。** threads だと
    // `process.env.TZ` は "UTC" を返すのに Date は親プロセスの TZ (JST) の
    // まま動く (#282 で実測)。既定は forks だが、明示して固定する。外れたら
    // `src/test/timezone.test.ts` が落ちる
    pool: "forks",
    env: { TZ: "UTC" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only は import しただけで throw する番兵で、node 環境の vitest は
      // react-server の export condition を解決しないため実体側に落ちる。
      // 番兵の効果は本番ビルドで担保されるので、テスト時は空 module に差し替える。
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
});
