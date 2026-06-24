import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SessionProfile } from "@/lib/auth";

type NavItem = { href: string; label: string };

/**
 * 教室長 (PC) 用シェル (#122)。
 * sticky ネイビーヘッダー + 横ナビ + `max-w-6xl` 本文。PC 管理前提で横ナビは
 * `overflow-x-auto`。講師は別シェル (TutorShell, 下部タブ) を使う。
 */
export function AdminShell({
  profile,
  nav,
  currentPath,
  children,
}: {
  profile: SessionProfile;
  nav: NavItem[];
  currentPath?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">Shift Manager</span>
            <span className="text-xs text-primary-foreground/70">管理者</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-primary-foreground/80 sm:inline">
              {profile.displayName}
            </span>
            <form action="/auth/signout" method="post">
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <LogOut />
                ログアウト
              </Button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {nav.map((item) => {
            const active =
              currentPath === item.href ||
              (currentPath?.startsWith(item.href + "/") ?? false);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-primary-foreground/15 text-primary-foreground"
                    : "text-primary-foreground/80 hover:bg-primary-foreground/10",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}
