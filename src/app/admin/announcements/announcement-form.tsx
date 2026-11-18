"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toFailedResult } from "@/lib/action-failure";
import {
  MAX_ANNOUNCEMENT_BODY,
  MAX_ANNOUNCEMENT_TITLE,
} from "@/lib/announcement";
import { cn } from "@/lib/utils";
import { sendAnnouncement } from "./actions";

/**
 * 教室長: お知らせを書いて講師全員に送るフォーム。
 * 送ると取り消すまで全員のベル・スマホに出るので、送る前に 1 回確かめる
 */
export function AnnouncementForm({ tutorCount }: { tutorCount: number }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function send() {
    setResult(null);
    startTransition(async () => {
      const res = await sendAnnouncement({ title, body }).catch(toFailedResult);
      setConfirming(false);
      if (res.ok) {
        setTitle("");
        setBody("");
        setResult({
          type: "ok",
          text: `講師 ${res.recipientCount} 人に送りました。`,
        });
        router.refresh();
      } else {
        // 失敗したら入力は消さない
        setResult({ type: "error", text: res.error });
      }
    });
  }

  const empty = body.trim() === "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty) setConfirming(true);
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="announcement-title">
          件名
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            （空なら本文の1行目）
          </span>
        </Label>
        <Input
          id="announcement-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setConfirming(false);
          }}
          maxLength={MAX_ANNOUNCEMENT_TITLE}
          placeholder="例: 来週のシフトとテスト前の注意"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="announcement-body">本文</Label>
        <textarea
          id="announcement-body"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setConfirming(false);
          }}
          maxLength={MAX_ANNOUNCEMENT_BODY}
          rows={10}
          required
          placeholder={"お疲れ様です。\n①シフトについて\n…"}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        />
        <p className="text-right text-xs text-muted-foreground">
          {body.length} / {MAX_ANNOUNCEMENT_BODY}
        </p>
      </div>

      {confirming ? (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
        >
          <p className="text-sm">
            講師 {tutorCount} 人のベルとスマホに届きます。送りますか？
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={send} disabled={isPending}>
              <Send />
              {isPending ? "送信中..." : "送る"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={isPending}
            >
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" className="w-full sm:w-auto" disabled={empty}>
          <Send />
          講師全員に送る
        </Button>
      )}

      {result && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1 text-sm",
            result.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {result.type === "ok" ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertCircle className="size-4 shrink-0" />
          )}
          {result.text}
        </p>
      )}
    </form>
  );
}
