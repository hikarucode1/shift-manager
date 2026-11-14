"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toFailedResult } from "@/lib/action-failure";
import {
  INQUIRY_KIND_LABEL,
  INQUIRY_KINDS,
  MAX_INQUIRY_BODY,
  type InquiryKind,
} from "@/lib/inquiry";
import { cn } from "@/lib/utils";
import { sendInquiry } from "./actions";

/**
 * お問い合わせのフォーム (#320)。講師・教室長の両方の画面で使う。
 * 名前とメールはログイン中のアカウントから自動で付くので、ここでは聞かない
 */
export function ContactForm({
  pagePath,
  senderLabel,
}: {
  /** どの画面から開いたか (ヘッダーのリンクが付ける)。無ければ null */
  pagePath: string | null;
  /** 「〇〇さん（講師）として送ります」の表示用 */
  senderLabel: string;
}) {
  const [kind, setKind] = useState<InquiryKind>("question");
  const [body, setBody] = useState("");
  const [wantsReply, setWantsReply] = useState(false);
  const [result, setResult] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await sendInquiry({ kind, body, wantsReply, pagePath }).catch(
        toFailedResult,
      );
      if (res.ok) {
        setBody("");
        setWantsReply(false);
        setResult({
          type: "ok",
          text: "送信しました。ありがとうございます。",
        });
      } else {
        // 失敗したら入力は消さない
        setResult({ type: "error", text: res.error });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">種類</legend>
        <div className="flex flex-wrap gap-2">
          {INQUIRY_KINDS.map((k) => (
            <label
              key={k}
              className={cn(
                "cursor-pointer rounded-md border px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                kind === k
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="sr-only"
              />
              {INQUIRY_KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="inquiry-body">内容</Label>
        <textarea
          id="inquiry-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_INQUIRY_BODY}
          rows={8}
          required
          placeholder={
            kind === "bug"
              ? "どの画面で、何をしたら、どうなったかを書いてください"
              : "分からないことや、こうしてほしいことを書いてください"
          }
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        />
        <p className="text-right text-xs text-muted-foreground">
          {body.length} / {MAX_INQUIRY_BODY}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={wantsReply}
          onChange={(e) => setWantsReply(e.target.checked)}
          className="size-4"
        />
        返信がほしい
      </label>

      <p className="text-xs text-muted-foreground">
        {senderLabel}として送ります。開いていた画面
        {pagePath ? `（${pagePath}）` : ""}も一緒に送ります。
      </p>

      <Button
        type="submit"
        className="w-full sm:w-auto"
        disabled={isPending || body.trim() === ""}
      >
        {isPending ? "送信中..." : "送信する"}
      </Button>

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
