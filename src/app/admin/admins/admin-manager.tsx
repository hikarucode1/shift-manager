"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { setAdminActive } from "./actions";

export type AdminRow = {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  createdAt: string;
};

// アバター背景色 (profile id から決定的に選ぶ)
const AVATAR_COLORS = [
  "bg-primary",
  "bg-accent",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-rose-600",
];

function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// 列幅: 氏名 / メール / 状態 / 操作
const COLS = "grid-cols-[1.4fr_1.8fr_1fr_.9fr]";

export function AdminManager({
  admins,
  currentAdminId,
  activeCount,
}: {
  admins: AdminRow[];
  currentAdminId: string;
  activeCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return admins;
    return admins.filter(
      (a) =>
        a.displayName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q),
    );
  }, [admins, search]);

  const handleToggle = (row: AdminRow) => {
    startTransition(async () => {
      const result = await setAdminActive({
        id: row.id,
        isActive: !row.isActive,
      });
      if (result.ok) {
        setNotice({
          type: "ok",
          text: row.isActive
            ? `${row.displayName} を無効化しました。`
            : `${row.displayName} を有効化しました。`,
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
      }
    });
  };

  return (
    <div className="space-y-4">
      {notice && (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            notice.type === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200",
          )}
        >
          {notice.text}
        </div>
      )}

      {/* ツールバー (検索のみ。教室長の新規追加は本 UI 不可) */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="氏名・メールで検索"
          className="h-9 max-w-[280px]"
          aria-label="氏名・メールで検索"
        />
        <span className="ml-auto text-sm text-muted-foreground">
          登録 {admins.length} 名 / 有効 {activeCount} 名
        </span>
      </div>

      {/* 一覧テーブル */}
      {admins.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          教室長が登録されていません。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px] overflow-hidden rounded-lg border">
            {/* ヘッダー */}
            <div
              className={cn(
                "grid border-b bg-muted text-xs font-semibold text-slate-600",
                COLS,
              )}
            >
              <div className="px-3.5 py-2.5">氏名</div>
              <div className="px-3.5 py-2.5">メール</div>
              <div className="px-3.5 py-2.5">状態</div>
              <div className="px-3.5 py-2.5 text-right">操作</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-sm text-muted-foreground">
                該当する教室長がいません。
              </div>
            ) : (
              filtered.map((a) => {
                const isSelf = a.id === currentAdminId;
                // 最後の active admin を deactivate しようとすると server 側で
                // reject されるが、UI 側でも事前に disable する。
                const wouldBeLastActive = a.isActive && activeCount <= 1;
                const disableToggle = isPending || isSelf || wouldBeLastActive;

                return (
                  <div
                    key={a.id}
                    className={cn(
                      "grid items-center border-b text-[13px] last:border-b-0",
                      COLS,
                      !a.isActive && "opacity-60",
                    )}
                  >
                    {/* 氏名 + アバター */}
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                          avatarColor(a.id),
                        )}
                        aria-hidden
                      >
                        {a.displayName.trim().charAt(0) || "?"}
                      </span>
                      <span className="truncate font-semibold">
                        {a.displayName}
                      </span>
                      {isSelf && (
                        <Badge variant="outline" className="shrink-0">
                          自分
                        </Badge>
                      )}
                    </div>
                    {/* メール */}
                    <div className="truncate px-3.5 py-2.5 text-muted-foreground">
                      {a.email}
                    </div>
                    {/* 状態 */}
                    <div className="px-3.5 py-2.5">
                      {a.isActive ? (
                        <Badge className="border-transparent bg-green-50 text-green-700 hover:bg-green-50">
                          有効
                        </Badge>
                      ) : (
                        <Badge variant="secondary">無効</Badge>
                      )}
                    </div>
                    {/* 操作 */}
                    <div className="px-3.5 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant={a.isActive ? "outline" : "default"}
                        disabled={disableToggle}
                        onClick={() => handleToggle(a)}
                        title={
                          isSelf
                            ? "自分自身は変更できません"
                            : wouldBeLastActive
                              ? "最後の有効な教室長は無効化できません"
                              : undefined
                        }
                      >
                        {a.isActive ? "無効化" : "有効化"}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
