import { expect, it } from "vitest";

// ⚠️ vitest.config.ts の TZ 固定が効いているかの番兵 (#282)。
// `pool` を threads に変えると `process.env.TZ` は "UTC" のまま Date だけ
// JST で動き、JST の暦を確かめるテスト (#279) が古い実装でも通ってしまう。
// 値ではなく実際のオフセットで確かめる
it("テストは UTC で走る (本番の Vercel と同じ)", () => {
  expect(new Date("2026-01-01T00:00:00Z").getTimezoneOffset()).toBe(0);
  expect(new Date("2026-07-01T00:00:00Z").getTimezoneOffset()).toBe(0);
});
