import { adminGuide } from "./admin";
import { tutorGuide } from "./tutor";
import type { Guide, GuideRole, GuideTopic } from "./types";

export type * from "./types";

const GUIDES: Record<GuideRole, Guide> = {
  tutor: tutorGuide,
  admin: adminGuide,
};

export function getGuide(role: GuideRole): Guide {
  return GUIDES[role];
}

export function findTopic(guide: Guide, slug: string): GuideTopic | null {
  return guide.topics.find((t) => t.slug === slug) ?? null;
}

/**
 * 開いていた画面 (`pathname`) に合うトピック。ヘッダーの「？」から来たとき、
 * 「いま開いていた画面の使い方」として一番上に出す。
 *
 * 前方一致で、**一番長く合った画面のトピックだけ**を返す (`/admin/training`
 * と `/admin/training/x` の両方に合うときは、より細かいほうを出す)。
 */
export function topicsForScreen(
  guide: Guide,
  pathname: string | null,
): GuideTopic[] {
  if (!pathname) return [];
  // 使い方・お問い合わせから来たときは「いまの画面」が無い
  if (matches(pathname, `${guide.base}/guide`)) return [];
  if (matches(pathname, `${guide.base}/contact`)) return [];

  let best = -1;
  let hit: GuideTopic[] = [];
  for (const topic of guide.topics) {
    let len = -1;
    for (const screen of topic.screens) {
      // ホーム (`/tutor` `/admin`) は完全一致だけ。前方一致にすると、どの
      // トピックにも書いていない画面でホームの使い方が出てしまう
      const ok =
        screen === guide.base ? pathname === screen : matches(pathname, screen);
      if (ok) len = Math.max(len, screen.length);
    }
    if (len < 0) continue;
    if (len > best) {
      best = len;
      hit = [topic];
    } else if (len === best) {
      hit.push(topic);
    }
  }
  return hit;
}

function matches(pathname: string, screen: string): boolean {
  return pathname === screen || pathname.startsWith(screen + "/");
}

/** `from` を付けた使い方・お問い合わせへのリンク (開いていた画面を持ち回る) */
export function withFrom(href: string, from: string | null): string {
  return from ? `${href}?from=${encodeURIComponent(from)}` : href;
}
