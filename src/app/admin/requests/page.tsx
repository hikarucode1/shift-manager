import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getPendingAbsenceRequests } from "@/lib/absences";
import { getPendingSwapRequests } from "@/lib/swaps";
import {
  getRequestLog,
  type LogPeriodFilter,
  type LogStateFilter,
  type LogTypeFilter,
} from "@/lib/request-log-query";
import { jstToday } from "@/lib/week";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AbsenceOnBehalfForm } from "./absence-on-behalf-form";
import { OpenSwapOnBehalfForm } from "./swap-on-behalf-form";
import { RecordSubstitutionForm } from "./record-substitution-form";
import { RequestsPanel } from "./requests-panel";
import { SwapRequestsPanel } from "./swap-requests-panel";
import { RequestLogPanel } from "./request-log-panel";

type Tab = "pending" | "log";

/**
 * 申請承認 (#224)。
 *
 * ⚠️ タブの軸は「用途」— **未対応 = 毎日の作業キュー / 記録 = たまに引く台帳**。
 * 以前は前半 2 つが種別 (欠勤/交代)、後半 2 つが状態 (承認済み/取り消し済み) で
 * 軸が混在していた。記録側は「あのコマを直したい」で引くので、種別で分かれて
 * いると両方のタブを見ることになる。
 *
 * ⚠️ タブとフィルタは **searchParams に載せる**。`useState` だとリロードや
 * 取り消し後の `router.refresh()` で未対応タブに戻ってしまう。
 */
export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    period?: string;
    type?: string;
    state?: string;
  }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;

  const tab: Tab = sp.tab === "log" ? "log" : "pending";
  const period: LogPeriodFilter =
    sp.period === "3m" || sp.period === "all" ? sp.period : "1m";
  const type: LogTypeFilter =
    sp.type === "absence" || sp.type === "swap" ? sp.type : "all";
  const state: LogStateFilter =
    sp.state === "approved" || sp.state === "cancelled" || sp.state === "rejected"
      ? sp.state
      : "all";

  const [pendingAbsences, pendingSwaps, log] = await Promise.all([
    getPendingAbsenceRequests(),
    getPendingSwapRequests(),
    // 未対応タブでも件数バッジのために引く…のは無駄なので、記録タブのときだけ
    tab === "log"
      ? getRequestLog({ period, type, state })
      : Promise.resolve({ rows: [], truncated: false }),
  ]);

  const pendingCount = pendingAbsences.length + pendingSwaps.length;
  const today = jstToday();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">申請承認</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師からの申請を承認 / 却下し、電話や口頭で受けた分を記録します。
        </p>
      </div>

      {/* 教室長が起点の操作。どちらのタブにも属さないのでタブの外に置く */}
      <div className="flex flex-wrap gap-2">
        <AbsenceOnBehalfForm today={today} />
        <OpenSwapOnBehalfForm today={today} />
        <RecordSubstitutionForm today={today} />
      </div>

      <div role="tablist" aria-label="表示の切り替え" className="flex gap-1 border-b">
        <TabLink tab="pending" active={tab === "pending"} label="未対応" count={pendingCount} />
        <TabLink tab="log" active={tab === "log"} label="記録" />
      </div>

      {tab === "pending" ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">欠勤申請</h2>
            <RequestsPanel pending={pendingAbsences} />
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">交代・代講</h2>
            <SwapRequestsPanel pending={pendingSwaps} />
          </section>
        </div>
      ) : (
        <RequestLogPanel
          log={log}
          period={period}
          type={type}
          state={state}
        />
      )}
    </div>
  );
}

function TabLink({
  tab,
  active,
  label,
  count,
}: {
  tab: Tab;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={tab === "pending" ? "/admin/requests" : "/admin/requests?tab=log"}
      role="tab"
      aria-selected={active}
      className={cn(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count !== undefined && (
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
      )}
    </Link>
  );
}
