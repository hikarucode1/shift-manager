"use client";

import { useState } from "react";
import type { PendingAbsence } from "@/lib/absences";
import type { AdminSwapRequest, SwapHistory } from "@/lib/swaps";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RequestsPanel } from "./requests-panel";
import { SwapRequestsPanel } from "./swap-requests-panel";
import { ApprovedSwapsPanel } from "./approved-swaps-panel";

type Tab = "absence" | "swap" | "approved" | "cancelled";

/**
 * 申請承認のタブ切替 (#129 デザイン screen 8)。
 * 欠勤申請 / 交代・代講 を Tabs で出し分け、各タブに未対応件数バッジを付ける。
 * データ取得は server (page.tsx)、ここは表示タブの保持のみ。
 */
export function RequestsTabs({
  pendingAbsences,
  pendingSwaps,
  approvedSwaps,
  cancelledSwaps,
}: {
  pendingAbsences: PendingAbsence[];
  pendingSwaps: AdminSwapRequest[];
  /** #213: 取り消しの対象。承認済みは終端ではなくなった */
  approvedSwaps: SwapHistory;
  /** #213: 取り消し理由を書かせた以上、書いた本人が読める場所が要る */
  cancelledSwaps: SwapHistory;
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
          tab="absence"
          active={tab === "absence"}
          onClick={() => setTab("absence")}
          label="欠勤申請"
          count={pendingAbsences.length}
        />
        <TabButton
          tab="swap"
          active={tab === "swap"}
          onClick={() => setTab("swap")}
          label="交代・代講"
          count={pendingSwaps.length}
        />
        <TabButton
          tab="approved"
          active={tab === "approved"}
          onClick={() => setTab("approved")}
          label="承認済み"
          count={approvedSwaps.rows.length}
        />
        <TabButton
          tab="cancelled"
          active={tab === "cancelled"}
          onClick={() => setTab("cancelled")}
          label="取り消し済み"
          count={cancelledSwaps.rows.length}
        />
      </div>

      <div
        role="tabpanel"
        id={`requests-panel-${tab}`}
        aria-labelledby={`requests-tab-${tab}`}
      >
        {tab === "absence" ? (
          <RequestsPanel pending={pendingAbsences} />
        ) : tab === "swap" ? (
          <SwapRequestsPanel pending={pendingSwaps} />
        ) : tab === "approved" ? (
          <ApprovedSwapsPanel history={approvedSwaps} />
        ) : (
          <ApprovedSwapsPanel history={cancelledSwaps} readOnly />
        )}
      </div>
    </div>
  );
}

function TabButton({
  tab,
  active,
  onClick,
  label,
  count,
}: {
  tab: Tab;
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`requests-tab-${tab}`}
      aria-selected={active}
      aria-controls={`requests-panel-${tab}`}
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
