import { describe, expect, it } from "vitest";
import {
  PREVIEW_BLOCKED_DATABASE_URL,
  isVercelPreview,
  resolveDatabaseUrl,
} from "./connection-url";

const PROD = "postgres://prod.example/db";

describe("resolveDatabaseUrl", () => {
  it("本番・ローカルでは DATABASE_URL をそのまま使う", () => {
    expect(
      resolveDatabaseUrl({ VERCEL_ENV: "production", DATABASE_URL: PROD }),
    ).toBe(PROD);
    expect(resolveDatabaseUrl({ DATABASE_URL: PROD })).toBe(PROD);
  });

  it("プレビューでは本番の DATABASE_URL を使わない", () => {
    expect(
      resolveDatabaseUrl({ VERCEL_ENV: "preview", DATABASE_URL: PROD }),
    ).toBe(PREVIEW_BLOCKED_DATABASE_URL);
  });

  it("プレビュー専用 DB があればそれを使う", () => {
    expect(
      resolveDatabaseUrl({
        VERCEL_ENV: "preview",
        DATABASE_URL: PROD,
        PREVIEW_DATABASE_URL: "postgres://preview.example/db",
      }),
    ).toBe("postgres://preview.example/db");
  });

  it("isVercelPreview は preview のときだけ true", () => {
    expect(
      ["preview", "production", "development", undefined].map((v) =>
        isVercelPreview({ VERCEL_ENV: v }),
      ),
    ).toEqual([true, false, false, false]);
  });
});
