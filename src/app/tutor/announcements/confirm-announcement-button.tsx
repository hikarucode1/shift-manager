"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toFailedResult } from "@/lib/action-failure";
import { confirmAnnouncementAction } from "./actions";

/** 講師: お知らせを「確認しました」(LINE のスタンプの代わり) */
export function ConfirmAnnouncementButton({
  id,
  confirmedAt,
}: {
  id: string;
  /** 確認済みなら時刻 (ISO) */
  confirmedAt: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (confirmedAt) {
    return (
      <p className="flex items-center gap-1 text-sm text-primary">
        <CheckCircle2 className="size-4" />
        確認済み（
        {new Date(confirmedAt).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        ）
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await confirmAnnouncementAction({ id }).catch(
              toFailedResult,
            );
            if (res.ok) router.refresh();
            else setError(res.error);
          });
        }}
      >
        {isPending ? "送信中..." : "確認しました"}
      </Button>
      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
