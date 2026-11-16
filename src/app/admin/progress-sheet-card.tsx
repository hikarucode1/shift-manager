"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toFailedResult } from "@/lib/action-failure";
import { saveProgressSheetUrl } from "./progress-sheet-actions";

/** 教室長ダッシュボード: 進行表を開く・URL を登録する (#339) */
export function ProgressSheetCard({ url }: { url: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(url === null);
  const [value, setValue] = useState(url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveProgressSheetUrl({ url: value }).catch(
        toFailedResult,
      );
      if (res.ok) {
        setEditing(value.trim() === "");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">進行表</h2>
          {url && !editing && (
            <>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                進行表を開く
                <ExternalLink className="size-3.5" />
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setValue(url);
                  setEditing(true);
                }}
              >
                URL を変える
              </Button>
            </>
          )}
        </div>
        {editing && (
          <>
            <p className="text-xs text-muted-foreground">
              進行表 (Google スプレッドシート) の URL を貼ると、講師のホームからも開けるようになります。
              中を誰が見られるかは、スプレッドシートの共有設定のままです。空にして保存すると登録を消します。
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="url"
                inputMode="url"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label="進行表の URL"
              />
              <div className="flex gap-2">
                <Button onClick={save} disabled={isPending}>
                  {isPending ? "保存中..." : "保存"}
                </Button>
                {url && (
                  <Button
                    variant="outline"
                    disabled={isPending}
                    onClick={() => {
                      setError(null);
                      setValue(url);
                      setEditing(false);
                    }}
                  >
                    やめる
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
        {error && (
          <p className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
