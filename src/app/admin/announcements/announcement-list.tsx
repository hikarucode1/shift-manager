"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toFailedResult } from "@/lib/action-failure";
import { cn } from "@/lib/utils";
import { removeAnnouncement } from "./actions";

export type AnnouncementListItem = {
  id: string;
  title: string;
  body: string;
  /** ISO */
  createdAt: string;
  senderName: string | null;
  recipientCount: number;
  confirmedCount: number;
  unconfirmed: { id: string; name: string }[];
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 教室長: 送ったお知らせと、確認した人数・まだの人 */
export function AnnouncementList({ items }: { items: AnnouncementListItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          まだお知らせを送っていません。
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id}>
          <AnnouncementCard item={a} />
        </li>
      ))}
    </ul>
  );
}

function AnnouncementCard({ item: a }: { item: AnnouncementListItem }) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const allDone = a.recipientCount > 0 && a.unconfirmed.length === 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium break-words">{a.title}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(a.createdAt)}
              {a.senderName && ` ・ ${a.senderName}`}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              allDone
                ? "bg-primary/10 text-primary"
                : "bg-accent/15 text-accent",
            )}
          >
            確認 {a.confirmedCount}/{a.recipientCount}人
          </span>
        </div>

        {allDone ? (
          <p className="flex items-center gap-1 text-sm text-primary">
            <CheckCircle2 className="size-4" />
            全員が確認しました
          </p>
        ) : (
          a.unconfirmed.length > 0 && (
            <div className="rounded-md bg-muted/60 p-2.5">
              <p className="text-xs font-medium text-muted-foreground">
                まだ確認していない人（{a.unconfirmed.length}人）
              </p>
              <p className="mt-1 text-sm break-words">
                {a.unconfirmed.map((u) => u.name).join("、")}
              </p>
            </div>
          )
        )}

        <details className="group">
          <summary className="cursor-pointer text-sm text-primary select-none">
            本文を見る
          </summary>
          <p className="mt-2 text-sm whitespace-pre-wrap break-words">
            {a.body}
          </p>
        </details>

        <div className="border-t pt-3">
          {confirmingDelete ? (
            <div className="space-y-2">
              <p className="text-sm">
                講師の画面とベルから消えます（スマホに届いた通知は消せません）。取り消しますか？
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const res = await removeAnnouncement({ id: a.id }).catch(
                        toFailedResult,
                      );
                      if (res.ok) router.refresh();
                      else {
                        setError(res.error);
                        setConfirmingDelete(false);
                      }
                    });
                  }}
                >
                  {isPending ? "取り消し中..." : "取り消す"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setConfirmingDelete(false)}
                >
                  やめる
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 />
              このお知らせを取り消す
            </Button>
          )}
          {error && (
            <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
