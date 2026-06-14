"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { setAdminActive } from "./actions";

export type AdminRow = {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  createdAt: string;
};

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

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">教室長一覧</CardTitle>
          <CardDescription>
            登録 {admins.length} 名 / 有効 {activeCount} 名
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {admins.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              教室長が登録されていません。
            </p>
          ) : (
            admins.map((a) => {
              const isSelf = a.id === currentAdminId;
              // 最後の active admin (自分以外に active がいない) を deactivate しようと
              // すると server side で reject されるが、UI 側でも事前に disable する。
              const wouldBeLastActive =
                a.isActive && activeCount <= 1;
              const disableToggle =
                isPending || isSelf || (a.isActive && wouldBeLastActive);

              return (
                <div
                  key={a.id}
                  className={cn(
                    "flex items-center justify-between rounded-md border p-3",
                    !a.isActive && "opacity-60",
                  )}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.displayName}</span>
                      {isSelf && <Badge variant="outline">自分</Badge>}
                      {a.isActive ? (
                        <Badge variant="default">有効</Badge>
                      ) : (
                        <Badge variant="secondary">無効</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={a.isActive ? "outline" : "default"}
                    disabled={disableToggle}
                    onClick={() => handleToggle(a)}
                    title={
                      isSelf
                        ? "自分自身は変更できません"
                        : a.isActive && wouldBeLastActive
                          ? "最後の有効な教室長は無効化できません"
                          : undefined
                    }
                  >
                    {a.isActive ? "無効化" : "有効化"}
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
