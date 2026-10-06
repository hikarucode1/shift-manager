import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // #295: next.config.ts に experimental.authInterrupts が無いので、
      // forbidden() / unauthorized() は呼ぶとただの Error を throw する。
      // layout の権限確認 (resolveOrIncident の中) から呼ぶと握り潰されて
      // SystemUnavailable になり、権限が無いだけの人に障害画面が出る。
      // 詳しくは docs/runbooks/loading-status.md の 2 節
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/navigation",
              importNames: ["forbidden", "unauthorized"],
              message:
                "authInterrupts が未設定なので使えません (ただの Error になり、layout からだと障害画面になる)。docs/runbooks/loading-status.md の 2 節を参照 (#295)。",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node scripts (CommonJS) and one-off tooling:
    "docs/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
