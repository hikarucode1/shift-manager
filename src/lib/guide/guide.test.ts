import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findTopic, getGuide, topicsForScreen, withFrom } from "./index";
import sizes from "./shots.json";
import type { Guide, GuideImage } from "./types";

// テストはリポジトリの一番上から走る (vitest.config.ts)
const PUBLIC_DIR = path.join(process.cwd(), "public");

const guides: Guide[] = [getGuide("tutor"), getGuide("admin")];

function imagesOf(guide: Guide): GuideImage[] {
  return guide.topics.flatMap((t) =>
    t.sections.flatMap((s) => [
      ...(s.image ? [s.image] : []),
      ...s.steps.flatMap((step) => (step.image ? [step.image] : [])),
    ]),
  );
}

describe.each(guides.map((g) => [g.role, g] as const))(
  "アプリの使い方 (%s)",
  (_role, guide) => {
    it("slug は重複せず、半角英小文字・数字と - だけ", () => {
      const slugs = guide.topics.map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it("カテゴリは一覧にあるものだけで、中身の無いカテゴリも無い", () => {
      const ids = guide.categories.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of guide.topics) expect(ids).toContain(t.category);
      for (const id of ids) {
        expect(guide.topics.some((t) => t.category === id)).toBe(true);
      }
    });

    it("「あわせて読む」は、実在する別のトピックを指す", () => {
      for (const t of guide.topics) {
        for (const slug of t.related ?? []) {
          expect(slug, `${t.slug} → ${slug}`).not.toBe(t.slug);
          expect(findTopic(guide, slug), `${t.slug} → ${slug}`).not.toBeNull();
        }
      }
    });

    it("関係する画面と「開く」ボタンは、自分の役割の画面だけ", () => {
      const own = (href: string) =>
        href === guide.base || href.startsWith(`${guide.base}/`);
      for (const t of guide.topics) {
        for (const screen of t.screens) expect(own(screen), screen).toBe(true);
        if (t.open) expect(own(t.open.href), t.open.href).toBe(true);
      }
    });

    it("どのトピックにも手順があり、文が空でない", () => {
      for (const t of guide.topics) {
        expect(t.title.trim()).not.toBe("");
        expect(t.summary.trim()).not.toBe("");
        expect(t.sections.length).toBeGreaterThan(0);
        for (const s of t.sections) {
          expect(s.steps.length, t.slug).toBeGreaterThan(0);
          for (const step of s.steps) expect(step.text.trim()).not.toBe("");
        }
      }
    });

    it("画像は自分の役割のフォルダのもので、ファイルがあり、説明が付いている", () => {
      for (const img of imagesOf(guide)) {
        expect(img.src.startsWith(`/guide/${guide.role}/`), img.src).toBe(true);
        expect(existsSync(path.join(PUBLIC_DIR, img.src)), img.src).toBe(true);
        expect(img.alt.trim(), img.src).not.toBe("");
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
      }
    });
  },
);

describe("アプリの使い方の画像", () => {
  const names = Object.keys(sizes);

  it("shots.json にある画像は、全部ファイルがある", () => {
    for (const name of names) {
      expect(
        existsSync(path.join(PUBLIC_DIR, "guide", `${name}.webp`)),
        name,
      ).toBe(true);
    }
  });

  it("public/guide に、shots.json に無い画像が残っていない", () => {
    for (const role of ["tutor", "admin"]) {
      const files = readdirSync(path.join(PUBLIC_DIR, "guide", role));
      for (const f of files) {
        expect(names, f).toContain(`${role}/${f.replace(/\.webp$/, "")}`);
      }
    }
  });

  it("撮った画像は、どこかの手順で使っている (使わない画像を配らない)", () => {
    const used = new Set(guides.flatMap(imagesOf).map((i) => i.src));
    for (const name of names) {
      expect(used.has(`/guide/${name}.webp`), name).toBe(true);
    }
  });
});

describe("topicsForScreen (開いていた画面に合う使い方)", () => {
  const tutor = getGuide("tutor");
  const admin = getGuide("admin");
  const slugs = (guide: Guide, pathname: string | null) =>
    topicsForScreen(guide, pathname).map((t) => t.slug);

  it("画面のパスに合うトピックを返す", () => {
    expect(slugs(tutor, "/tutor/absences")).toContain("absence");
    expect(slugs(admin, "/admin/uploads")).toContain("upload");
  });

  it("下の階層の画面でも、上の画面のトピックが出る", () => {
    expect(slugs(admin, "/admin/training/some-period")).toEqual(
      slugs(admin, "/admin/training"),
    );
  });

  it("ホームは完全一致だけ (どのトピックにも無い画面でホームの使い方を出さない)", () => {
    expect(slugs(tutor, "/tutor").length).toBeGreaterThan(0);
    expect(slugs(tutor, "/tutor/unknown-screen")).toEqual([]);
  });

  it("使い方・お問い合わせから来たとき、画面が分からないときは出さない", () => {
    expect(slugs(tutor, "/tutor/guide/absence")).toEqual([]);
    expect(slugs(admin, "/admin/contact")).toEqual([]);
    expect(slugs(tutor, null)).toEqual([]);
  });
});

describe("withFrom", () => {
  it("開いていた画面を from に付ける", () => {
    expect(withFrom("/tutor/guide", "/tutor/absences")).toBe(
      "/tutor/guide?from=%2Ftutor%2Fabsences",
    );
    expect(withFrom("/tutor/guide", null)).toBe("/tutor/guide");
  });
});
