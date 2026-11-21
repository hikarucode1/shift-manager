"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { underPath } from "@/lib/utils";

/**
 * ヘッダーの「アプリの使い方」への入口 (2026/11/21 本人依頼)。
 * 開いていた画面のパスを `from` に付けて渡す。使い方の一覧はこれを見て、
 * その画面に合う手順を一番上に出す (お問い合わせにもそのまま持ち回る)
 */
export function GuideLink({
  base,
  className,
  children,
  ariaLabel,
}: {
  /** "/tutor" か "/admin" */
  base: "/tutor" | "/admin";
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const guide = `${base}/guide`;
  // 使い方・お問い合わせを開いているときは「元の画面」が無いので付けない
  const hasScreen =
    !!pathname &&
    !underPath(pathname, guide) &&
    !underPath(pathname, `${base}/contact`);
  const href = hasScreen
    ? `${guide}?from=${encodeURIComponent(pathname)}`
    : guide;
  return (
    <Link href={href} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
