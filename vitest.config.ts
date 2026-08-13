import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
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
