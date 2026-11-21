"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TrainingTutorStatus } from "@/lib/training-overview";
import { formatDateRange } from "@/lib/training-ranges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrackDot } from "@/components/subject-filter-bar";
import { cn } from "@/lib/utils";

/**
 * 室長レビュー要望11: 講習の提出状況を、レギュラーの「講師別ステータス」と
 * 同じ形で出す (数のタイル → まだ提出していない人 → 書き込み → 全員分は開いたときだけ)
 */
const STATUS_TILES = [
  { key: "submitted", label: "提出済み", tone: "border-primary/30 bg-primary/5" },
  { key: "draft", label: "一時保存（未提出）", tone: "border-amber-300 bg-amber-50" },
  { key: "none", label: "未提出", tone: "border-destructive/30 bg-destructive/5" },
] as const;

const BADGE: Record<
  TrainingTutorStatus["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  submitted: { label: "提出済み", variant: "default" },
  draft: { label: "一時保存", variant: "secondary" },
  none: { label: "未提出", variant: "outline" },
};

function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** テスト期間・長期休みを 1 行に */
function rangesText(t: TrainingTutorStatus): string {
  const parts: string[] = [];
  if (t.testFrom && t.testTo) {
    parts.push(`テスト期間 ${formatDateRange(t.testFrom, t.testTo)}`);
  }
  if (t.summerFrom && t.summerTo) {
    parts.push(`長期休み ${formatDateRange(t.summerFrom, t.summerTo)}`);
  }
  return parts.join("　");
}

export function TrainingStatusCard({
  tutors,
}: {
  tutors: TrainingTutorStatus[];
}) {
  const [showAll, setShowAll] = useState(false);
  const notYet = tutors.filter((t) => t.status !== "submitted");
  // 教室長に見せるのは提出済みの講師の書き込みだけ (本番チェック No.12)
  const withNotes = tutors.filter(
    (t) =>
      t.status === "submitted" &&
      (t.note.trim() !== "" || rangesText(t) !== ""),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">講師別ステータス</CardTitle>
        <CardDescription>{tutors.length} 名分の提出状況です。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {STATUS_TILES.map((tile) => {
            const n = tutors.filter((t) => t.status === tile.key).length;
            return (
              <div
                key={tile.key}
                className={cn("rounded-lg border p-3", n > 0 && tile.tone)}
              >
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                <p className="text-2xl font-bold tabular-nums">
                  {n}
                  <span className="ml-0.5 text-sm font-normal">名</span>
                </p>
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            まだ提出していない人 ({notYet.length} 名)
          </p>
          {notYet.length === 0 ? (
            <p className="text-sm text-muted-foreground">全員が提出しました。</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {notYet.map((t) => (
                <span
                  key={t.tutorId}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                >
                  <TrackDot track={t.track} />
                  {t.name}
                  {t.status === "draft" && (
                    <span className="text-muted-foreground">（一時保存）</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {withNotes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              備考・予定の書き込み ({withNotes.length} 名)
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {withNotes.map((t) => (
                <li key={t.tutorId}>
                  <span className="font-medium text-foreground">{t.name}</span>
                  {rangesText(t) && <>：{rangesText(t)}</>}
                  {t.note.trim() && (
                    <span className="whitespace-pre-wrap">：📝 {t.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? (
            <ChevronUp className="mr-1 size-4" />
          ) : (
            <ChevronDown className="mr-1 size-4" />
          )}
          {showAll ? "提出状況を閉じる" : "提出状況を確認する"}
        </Button>
      </CardContent>
      {showAll && (
        <CardContent className="space-y-3 border-t pt-4">
          {tutors.map((t) => {
            const badge = BADGE[t.status];
            return (
              <div
                key={t.tutorId}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3"
              >
                <div className="min-w-[10rem] flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <TrackDot track={t.track} />
                    {t.name}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.email}</div>
                </div>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                {t.status !== "none" && (
                  <div className="text-xs text-muted-foreground">
                    選んだコマ: {t.slotCount} コマ
                    {t.submittedAt && <> ・提出 {fmtJst(t.submittedAt)}</>}
                  </div>
                )}
                {t.status === "submitted" && rangesText(t) && (
                  <p className="mt-1 w-full text-xs text-muted-foreground">
                    {rangesText(t)}
                  </p>
                )}
                {t.status === "submitted" && t.note.trim() && (
                  <p className="mt-1 w-full whitespace-pre-wrap text-xs text-muted-foreground">
                    📝 {t.note}
                  </p>
                )}
              </div>
            );
          })}
          {tutors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              有効な講師がいません。
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
