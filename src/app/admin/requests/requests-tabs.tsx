"use client";

import { useState } from "react";
import type { PendingAbsence } from "@/lib/absences";
import type { AdminSwapRequest } from "@/lib/swaps";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RequestsPanel } from "./requests-panel";
import { SwapRequestsPanel } from "./swap-requests-panel";

type Tab = "absence" | "swap";

/**
 * 申請承認のタブ切替 (#129 デザイン screen 8)。
 * 欠勤申請 / 交代・代講 を Tabs で出し分け、各タブに未対応件数バッジを付ける。
 * データ取得は server (page.tsx)、ここは表示タブの保持のみ。
 */
export function RequestsTabs({
  pendingAbsences,
  pendingSwaps,
}: {
  pendingAbsences: PendingAbsence[];
  pendingSwaps: AdminSwapRequest[];
}) {
  const [tab, setTab] = useState<Tab>("absence");

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="申請の種類"
        className="flex gap-1 border-b"
      >
        <TabButton
          active={tab === "absence"}
          onClick={() => setTab("absence")}
          label="欠勤申請"
          count={pendingAbsences.length}
        />
        <TabButton
          active={tab === "swap"}
          onClick={() => setTab("swap")}
          label="交代・代講"
          count={pendingSwaps.length}
        />
      </div>

      {tab === "absence" ? (
        <RequestsPanel pending={pendingAbsences} />
      ) : (
        <SwapRequestsPanel pending={pendingSwaps} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <Badge
        className={cn(
          "border-transparent",
          count > 0
            ? "bg-accent/15 text-accent hover:bg-accent/15"
            : "bg-muted text-muted-foreground hover:bg-muted",
        )}
      >
        {count}
      </Badge>
    </button>
  );
}
