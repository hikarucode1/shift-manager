"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * ヘッダーの「お問い合わせ」への入口 (#320)。開いていた画面のパスを
 * `from` に付けて渡す (問い合わせに「どの画面で」を自動で入れるため)
 */
export function ContactLink({
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
  const contact = `${base}/contact`;
  const href =
    pathname && pathname !== contact
      ? `${contact}?from=${encodeURIComponent(pathname)}`
      : contact;
  return (
    <Link href={href} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
