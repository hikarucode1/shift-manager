"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Mail, Pencil, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

export function TutorManager({ tutors }: { tutors: TutorRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // stub 紐付け用: 行ごとのメール入力
  const [linkOpenId, setLinkOpenId] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState("");

  const linkedCount = tutors.filter((t) => t.linked).length;
  const stubCount = tutors.length - linkedCount;

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
      },
    );
  }

  function handleLink(profileId: string) {
    run(
      () =>
        inviteTutor({
          mode: "link",
          email: linkEmail.trim(),
          profileId,
        }),
      "招待メールを送信し、講師に紐付けました。",
      () => {
        setLinkOpenId(null);
        setLinkEmail("");
      },
    );
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

      {/* 新規招待フォーム */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4" />
            講師を新規招待
          </CardTitle>
          <CardDescription>
            入力したメールアドレスに、パスワード設定リンク付きの招待メールが届きます。
            既に CSV から登録済みの講師は、下の一覧の「招待」から紐付けてください。
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              {isPending ? "送信中..." : "招待"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 講師一覧 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            講師一覧
            <Badge variant="secondary">{tutors.length} 名</Badge>
            {stubCount > 0 && (
              <Badge variant="outline">未連携 {stubCount} 名</Badge>
            )}
          </CardTitle>
          <CardDescription>
            「未連携」は CSV から取り込まれただけでログインできません。「招待」で本人のメールに紐付けると有効になります。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tutors.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              講師がまだ登録されていません。
            </p>
          ) : (
            <div className="divide-y">
              {tutors.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between",
                    !t.isActive && "opacity-60",
                  )}
                >
                  <div className="min-w-0">
                    {editingId === t.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 w-48"
                          aria-label="氏名"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          disabled={isPending}
                          aria-label="保存"
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
                          <Check />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="キャンセル"
                          onClick={() => setEditingId(null)}
                        >
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.displayName}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="氏名を編集"
                          onClick={() => {
                            setEditingId(t.id);
                            setEditName(t.displayName);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {!t.linked ? (
                          <Badge variant="destructive">未連携</Badge>
                        ) : t.isActive ? (
                          <Badge variant="secondary">有効</Badge>
                        ) : (
                          <Badge variant="outline">無効</Badge>
                        )}
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {t.linked ? t.email : "ログイン未連携"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!t.linked ? (
                      linkOpenId === t.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="email"
                            value={linkEmail}
                            onChange={(e) => setLinkEmail(e.target.value)}
                            placeholder="tutor@example.com"
                            className="h-8 w-56"
                            aria-label="招待メールアドレス"
                          />
                          <Button
                            size="sm"
                            disabled={isPending || !linkEmail.trim()}
                            onClick={() => handleLink(t.id)}
                          >
                            送信
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label="キャンセル"
                            onClick={() => {
                              setLinkOpenId(null);
                              setLinkEmail("");
                            }}
                          >
                            <X />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            setLinkOpenId(t.id);
                            setLinkEmail("");
                          }}
                        >
                          <Mail className="size-4" />
                          招待
                        </Button>
                      )
                    ) : (
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
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
