import { requireRole } from "@/lib/auth";
import { getTutorAnnouncements } from "@/lib/announcements-db";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ConfirmAnnouncementButton } from "./confirm-announcement-button";

function formatDateTime(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 講師: 教室長からのお知らせ。読んだら「確認しました」を押す */
export default async function TutorAnnouncementsPage() {
  const { profile } = await requireRole("tutor");
  const items = await getTutorAnnouncements(profile.id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">教室長からのお知らせ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          読んだら「確認しました」を押してください。教室長に伝わります。
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            お知らせはまだありません。
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id}>
              <Card
                className={cn(!a.confirmedAt && "border-accent/50 bg-accent/5")}
              >
                <CardContent className="space-y-3 p-4">
                  <div>
                    <p className="font-medium break-words">
                      {!a.confirmedAt && (
                        <span className="mr-1.5 rounded bg-accent px-1.5 py-0.5 align-middle text-[11px] font-semibold text-accent-foreground">
                          未確認
                        </span>
                      )}
                      {a.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(a.createdAt)}
                    </p>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {a.body}
                  </p>
                  <ConfirmAnnouncementButton
                    id={a.id}
                    confirmedAt={a.confirmedAt?.toISOString() ?? null}
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
