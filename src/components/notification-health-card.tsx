import { HEALTH_WINDOW_DAYS, type NotificationHealthView } from "@/lib/notification-health";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * #191: 通知の健全性カード。KPI と並べるが、**業務の数字ではなくシステムの
 * 状態**なので、取得できないときは色で区別する (0 件と同じ顔をさせない)。
 */
export function NotificationHealthCard({ view }: { view: NotificationHealthView }) {
  const broken = view.state === "unavailable";
  return (
    <Card
      className={cn(
        "border-l-[3px]",
        broken ? "border-l-destructive" : "border-l-accent",
      )}
    >
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">
          通知配信（{HEALTH_WINDOW_DAYS}日）
        </p>
        <p
          className={cn(
            "mt-1 font-bold leading-none",
            broken
              ? "text-[20px] text-destructive"
              : "text-[28px] text-accent",
          )}
          // 取得不可は障害なので読み上げにも載せる
          role={broken ? "alert" : undefined}
        >
          {view.value}
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {view.caption}
        </p>
      </CardContent>
    </Card>
  );
}
