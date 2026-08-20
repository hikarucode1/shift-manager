"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { notifyCoursePublication } from "./confirm-actions";

/**
 * 確定シフトの公開を確定済み講師へ通知するボタン (#155)。
 * 確定保存 (セル単位) と分離し、教室長の任意タイミングで送る。
 */
export function NotifyPublicationButton({ periodId }: { periodId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  async function onClick() {
    if (
      !window.confirm(
        "確定済みの全講師に「確定シフトが公開されました」と通知します。よろしいですか?",
      )
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    // action-failure: ok — 操作固有の文言を出すため共有版を使わない。
    // startTransition を通さないので error.tsx にも飛ばない。
    const res = await notifyCoursePublication({ periodId }).catch(() => ({
      ok: false as const,
      error: "通知の送信に失敗しました。再度お試しください。",
    }));
    setPending(false);
    setMessage(
      res.ok
        ? { type: "ok", text: `${res.notified} 名の講師に通知しました。` }
        : { type: "error", text: res.error },
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={onClick}
      >
        <Megaphone className="size-4" />
        {pending ? "送信中..." : "講師に公開を通知"}
      </Button>
      {message && (
        <span
          role="status"
          className={cn(
            "text-xs",
            message.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
