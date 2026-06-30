"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Mail, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { avatarColor, avatarInitial } from "@/lib/avatar";
import { inviteTutor, renameTutor, setTutorActive } from "./actions";

export type TutorRow = {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  /** auth.users と連携済み (= ログイン可能) か */
  linked: boolean;
  createdAt: string;
};

type StatusFilter = "all" | "linked" | "unlinked";

// 列幅: 氏名 / メール / 状態 / 担当科目 / 操作
const COLS = "grid-cols-[1.2fr_1.6fr_.9fr_1.3fr_.8fr]";

export function TutorManager({ tutors }: { tutors: TutorRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  // ツールバー
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);

  // 新規招待フォーム
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  // 行内編集 (氏名変更・連携・有効/無効)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [linkEmail, setLinkEmail] = useState("");

  const linkedCount = tutors.filter((t) => t.linked).length;
  const stubCount = tutors.length - linkedCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tutors.filter((t) => {
      if (statusFilter === "linked" && !t.linked) return false;
      if (statusFilter === "unlinked" && t.linked) return false;
      if (!q) return true;
      if (t.displayName.toLowerCase().includes(q)) return true;
      // 未連携行は UI 上メールを隠す (「ログイン未連携」表示) ため、
      // 隠れた実メールで誤ヒットしないよう連携済みのみメールを検索対象にする。
      return t.linked && t.email.toLowerCase().includes(q);
    });
  }, [tutors, search, statusFilter]);

  // 通知は数秒で自動的に消す
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
    onSuccess?: () => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onSuccess?.();
        router.refresh();
      } else {
        // 失敗時は入力状態を保持し、エラーだけ表示
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
      }
    });
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        inviteTutor({
          mode: "new",
          email: email.trim(),
          displayName: name.trim(),
        }),
      "招待メールを送信しました。",
      () => {
        setEmail("");
        setName("");
        setInviteOpen(false);
      },
    );
  }

  function startEdit(t: TutorRow) {
    setEditingId(t.id);
    setEditName(t.displayName);
    setLinkEmail("");
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1 text-sm",
            notice.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {notice.type === "error" && <AlertCircle className="size-4" />}
          {notice.text}
        </p>
      )}

      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="氏名・メールで検索"
          className="h-9 max-w-[280px]"
          aria-label="氏名・メールで検索"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-9 rounded-md border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="状態で絞り込み"
        >
          <option value="all">すべての状態</option>
          <option value="linked">連携済 ({linkedCount})</option>
          <option value="unlinked">未連携 ({stubCount})</option>
        </select>
        <Button
          className="ml-auto"
          onClick={() => setInviteOpen((v) => !v)}
          aria-expanded={inviteOpen}
        >
          <UserPlus />
          講師を招待
        </Button>
      </div>

      {/* 新規招待フォーム (トグル) */}
      {inviteOpen && (
        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            入力したメールアドレスに、パスワード設定リンク付きの招待メールが届きます。
            既に CSV から登録済みの講師は、一覧の「編集」から紐付けてください。
          </p>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={handleInvite}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="inv-name">氏名（CSV の講師名と一致させる）</Label>
              <Input
                id="inv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="山本美里"
                required
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="inv-email">メールアドレス</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tutor@example.com"
                required
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "送信中..." : "招待を送信"}
            </Button>
          </form>
        </div>
      )}

      {/* 一覧テーブル */}
      {tutors.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          講師がまだ登録されていません。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px] overflow-hidden rounded-lg border">
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
              <div className="px-3.5 py-2.5">担当科目</div>
              <div className="px-3.5 py-2.5 text-right">操作</div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-sm text-muted-foreground">
                該当する講師がいません。
              </div>
            ) : (
              filtered.map((t) => {
                const editing = editingId === t.id;
                return (
                  <div key={t.id} className="border-b last:border-b-0">
                    <div
                      className={cn(
                        "grid items-center text-[13px]",
                        COLS,
                        !t.isActive && "opacity-60",
                      )}
                    >
                      {/* 氏名 + アバター */}
                      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                            avatarColor(t.id),
                          )}
                          aria-hidden
                        >
                          {avatarInitial(t.displayName)}
                        </span>
                        <span className="truncate font-semibold">
                          {t.displayName}
                        </span>
                      </div>
                      {/* メール */}
                      <div className="truncate px-3.5 py-2.5 text-muted-foreground">
                        {t.linked ? t.email : "ログイン未連携"}
                      </div>
                      {/* 状態 */}
                      <div className="px-3.5 py-2.5">
                        {!t.linked ? (
                          <Badge className="border-transparent bg-accent/10 text-accent hover:bg-accent/10">
                            未連携
                          </Badge>
                        ) : t.isActive ? (
                          <Badge className="border-transparent bg-green-50 text-green-700 hover:bg-green-50">
                            連携済
                          </Badge>
                        ) : (
                          <Badge variant="secondary">無効</Badge>
                        )}
                      </div>
                      {/* 担当科目 (per-tutor マスタ未対応) */}
                      <div className="px-3.5 py-2.5 text-muted-foreground/50">
                        —
                      </div>
                      {/* 操作 */}
                      <div className="px-3.5 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 font-semibold text-primary"
                          onClick={() =>
                            editing ? setEditingId(null) : startEdit(t)
                          }
                        >
                          {editing ? "閉じる" : "編集"}
                        </Button>
                      </div>
                    </div>

                    {/* 行内編集パネル */}
                    {editing && (
                      <div className="space-y-4 border-t bg-muted/40 px-3.5 py-4">
                        {/* 氏名変更 */}
                        <div className="space-y-1">
                          <Label htmlFor={`edit-name-${t.id}`}>氏名</Label>
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              id={`edit-name-${t.id}`}
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="h-8 w-56"
                            />
                            <Button
                              size="sm"
                              disabled={isPending || !editName.trim()}
                              onClick={() =>
                                run(
                                  () =>
                                    renameTutor({
                                      id: t.id,
                                      displayName: editName.trim(),
                                    }),
                                  "氏名を変更しました。",
                                )
                              }
                            >
                              氏名を保存
                            </Button>
                          </div>
                        </div>

                        {/* 連携 / 有効・無効 */}
                        {!t.linked ? (
                          <div className="space-y-1">
                            <Label htmlFor={`link-email-${t.id}`}>
                              ログイン連携（招待メール送信）
                            </Label>
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                id={`link-email-${t.id}`}
                                type="email"
                                value={linkEmail}
                                onChange={(e) => setLinkEmail(e.target.value)}
                                placeholder="tutor@example.com"
                                className="h-8 w-64"
                              />
                              <Button
                                size="sm"
                                disabled={isPending || !linkEmail.trim()}
                                onClick={() =>
                                  run(
                                    () =>
                                      inviteTutor({
                                        mode: "link",
                                        email: linkEmail.trim(),
                                        profileId: t.id,
                                      }),
                                    "招待メールを送信し、講師に紐付けました。",
                                    () => {
                                      setLinkEmail("");
                                      setEditingId(null);
                                    },
                                  )
                                }
                              >
                                <Mail className="size-4" />
                                招待を送信
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button
                              variant={t.isActive ? "outline" : "default"}
                              size="sm"
                              disabled={isPending}
                              onClick={() =>
                                run(
                                  () =>
                                    setTutorActive({
                                      id: t.id,
                                      isActive: !t.isActive,
                                    }),
                                  t.isActive
                                    ? "無効化しました。"
                                    : "有効化しました。",
                                )
                              }
                            >
                              {t.isActive ? "無効化" : "有効化"}
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              無効化するとログインできなくなります（削除はできません）。
                            </span>
                          </div>
                        )}

                        <div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-muted-foreground"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="size-4" />
                            閉じる
                          </Button>
                        </div>
                      </div>
                    )}
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
