import Link from "next/link";
import { Bell, CalendarCheck, Inbox, Repeat } from "lucide-react";
import type { NotificationRow, NotificationType } from "@/lib/notifications";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  absence_result: Inbox,
  swap_result: Inbox,
  shifts_published: CalendarCheck,
  swap_posted: Repeat,
};

function formatDateTime(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 通知一覧の表示部 (#155)。データ取得は持たない */
export function NotificationList({ items }: { items: NotificationRow[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          通知はまだありません。
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((n) => {
        const Icon = TYPE_ICON[n.type];
        const unread = !n.readAt;
        const inner = (
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3",
              unread ? "border-accent/50 bg-accent/5" : "bg-background",
              n.href && "transition-colors hover:bg-muted/50",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                unread ? "text-accent" : "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "text-sm",
                    unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {n.title}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(n.createdAt)}
                </span>
              </div>
              {n.body && (
                <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
              )}
            </div>
            {unread && (
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
            )}
          </div>
        );
        return (
          <li key={n.id}>
            {n.href ? <Link href={n.href}>{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}
