import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * pathname が href 自身またはその配下か (セグメント境界付き prefix 判定)。
 * 素の startsWith だと /tutor/swaps-history のような prefix 共有ルートを
 * 誤マッチするため、各ナビ (AdminTopNav / TutorBottomNav / SegmentedNav)
 * はこれを使う。
 */
export function underPath(pathname: string | null, href: string): boolean {
  return pathname === href || (pathname?.startsWith(href + "/") ?? false);
}
