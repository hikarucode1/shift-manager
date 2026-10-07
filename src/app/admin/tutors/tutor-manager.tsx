"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, KeyRound, Mail, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  isIndeterminate,
  isStale,
  toFailedResult,
} from "@/lib/action-failure";
import { cn } from "@/lib/utils";
import { avatarColor, avatarInitial } from "@/lib/avatar";
import type { InviteStatus } from "@/lib/invite-resend";
import {
  isResendable,
  isTutorVisible,
  normalizeQuery,
  type StatusFilter,
} from "@/lib/tutor-list-filter";
import {
  inviteTutor,
  renameTutor,
  resendInvite,
  sendPasswordReset,
  setTutorActive,
} from "./actions";

export type TutorRow = {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  /** 教室長を兼任しているか (docs/design/dual-role.md) */
  isAdmin: boolean;
  /** auth.users と連携済み (= ログイン可能) か */
  linked: boolean;
  /**
   * 招待を受け取ったか (#265)。未連携は null。
   * unknown = 認証 API から読めなかった (再送の可否はサーバーが判定する)
   */
  inviteStatus: InviteStatus | null;
  createdAt: string;
};

// 列幅: 氏名 / メール / 状態 / 担当科目 / 操作
const COLS = "grid-cols-[1.2fr_1.6fr_.9fr_1.3fr_.8fr]";

export function TutorManager({
  tutors,
  currentProfileId,
  activeAdminCount,
  inviteStatusLoaded,
}: {
  tutors: TutorRow[];
  currentProfileId: string;
  /** 有効な教室長の総数 (兼任者の「最後の有効教室長」判定に使う) */
  activeAdminCount: number;
  /** 認証 API から招待の状態を読めたか。false なら「招待中」の件数も当てにならない */
  inviteStatusLoaded: boolean;
}) {
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
  const pendingCount = tutors.filter(isResendable).length;
  // 「うち招待中」を選んだ後に読み込みが失敗したら、「すべての状態」に戻す。
  // そのままだと全員が「招待中ではない」と判定され、一覧が空になる (#271)。
  // 表示だけを変えると、選び直しても onChange が起きず、次に読み込めたとき
  // 勝手に絞り込みが戻るので、state ごと直す。描画のたびに確かめる (React の
  // 「前の描画の情報で state を直す」パターン。effect でやると lint の
  // set-state-in-effect に当たる)
  if (statusFilter === "pending" && !inviteStatusLoaded) {
    setStatusFilter("all");
  }

  const filtered = useMemo(() => {
    const query = normalizeQuery(search);
    return tutors.filter((t) =>
      isTutorVisible(t, { statusFilter, query, editingId }),
    );
  }, [tutors, search, statusFilter, editingId]);

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
    /**
     * 成功したら画面を読み直すか。招待の再送とパスワード再設定メールは
     * 講師の状態を何も変えないので false にする。読み直すと認証 API から
     * ユーザーを全件読み直すことになる (#271)
     */
    refreshOnSuccess = true,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onSuccess?.();
        if (refreshOnSuccess) router.refresh();
      } else {
        // 失敗時は入力状態を保持し、エラーだけ表示
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
        // #202: reject 由来は「書いたか不明」なのでサーバーから読み直す。
        // #300: 画面の状態が古いと分かって断られたときも読み直す (受け取り済み
        // なのに「招待中」のままだと、エラーの案内どおりに操作できない)
        if (isIndeterminate(res) || isStale(res)) router.refresh();
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

      {!inviteStatusLoaded && (
        <p className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle className="size-4 shrink-0" />
          招待の状態を読み込めませんでした。「状態不明」の講師が招待を受け取ったかは、時間をおいて再読み込みすると確認できます。
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
          {/* 招待の状態を読めなかったときは、件数を「0」と出さない。選ぶと空の
              一覧になり、招待中の講師がいないように見える (#271) */}
          <option value="pending" disabled={!inviteStatusLoaded}>
            うち招待中 ({inviteStatusLoaded ? pendingCount : "不明"})
          </option>
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
                const isSelf = t.id === currentProfileId;
                // 兼任者が最後の有効な教室長のとき、無効化はサーバーで reject
                // される。admin 一覧と同様に UI でも事前 disable する。
                const wouldBeLastActive =
                  t.isAdmin && t.isActive && activeAdminCount <= 1;
                const disableToggle = isPending || isSelf || wouldBeLastActive;
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
                        {t.id === currentProfileId && (
                          <Badge variant="outline" className="shrink-0">
                            自分
                          </Badge>
                        )}
                        {t.isAdmin && (
                          <Badge variant="outline" className="shrink-0">
                            教室長兼任
                          </Badge>
                        )}
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
                        ) : !t.isActive ? (
                          <Badge variant="secondary">無効</Badge>
                        ) : t.inviteStatus === "pending" ? (
                          <Badge
                            className="border-transparent bg-amber-50 text-amber-700 hover:bg-amber-50"
                            title="招待メールのリンクがまだ使われていません"
                          >
                            招待中
                          </Badge>
                        ) : t.inviteStatus === "unknown" ? (
                          <Badge
                            variant="outline"
                            title="招待を受け取ったか確認できませんでした"
                          >
                            状態不明
                          </Badge>
                        ) : (
                          <Badge className="border-transparent bg-green-50 text-green-700 hover:bg-green-50">
                            連携済
                          </Badge>
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
                                    // 紐付けた行の編集だけを閉じる。待っている
                                    // 間に別の行を開いていたら、そちらは閉じない
                                    // (編集中だから残っている行が消えるため。
                                    // #302)。入力欄は開くときに startEdit が空にする
                                    () =>
                                      setEditingId((cur) =>
                                        cur === t.id ? null : cur,
                                      ),
                                  )
                                }
                              >
                                <Mail className="size-4" />
                                招待を送信
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* 招待の再送 (#265)。受け取り済みと分かっている相手には出さない */}
                            {t.isActive && t.inviteStatus !== "accepted" && (
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={() =>
                                    run(
                                      () => resendInvite({ profileId: t.id }),
                                      "招待メールを再送しました。前に送ったリンクは使えなくなります。",
                                      undefined,
                                      false,
                                    )
                                  }
                                >
                                  <Mail className="size-4" />
                                  招待を再送
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {t.inviteStatus === "pending"
                                    ? `${t.email} はまだ招待リンクを使っていません。期限切れのときに送り直せます。`
                                    : "招待の状態を確認できませんでした。受け取り済みの場合は送信されません。"}
                                </span>
                              </div>
                            )}
                            {/* パスワード再設定メール (#268)。招待中と分かっている相手には
                                招待の再送のほうを使う (サーバーも NOT_YET_ACCEPTED で断る) */}
                            {t.isActive && t.inviteStatus !== "pending" && (
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={() =>
                                    run(
                                      () => sendPasswordReset({ profileId: t.id }),
                                      "パスワード再設定メールを送りました。",
                                      undefined,
                                      false,
                                    )
                                  }
                                >
                                  <KeyRound className="size-4" />
                                  パスワード再設定メール
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {t.inviteStatus === "accepted"
                                    ? `パスワードが分からなくなったときに ${t.email} へ送ります。リンクから新しいパスワードを決めてもらいます。`
                                    : "招待を受け取り済みの講師にだけ送信されます。"}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <Button
                                variant={t.isActive ? "outline" : "default"}
                                size="sm"
                                disabled={disableToggle}
                                title={
                                  isSelf
                                    ? "自分自身は変更できません"
                                    : wouldBeLastActive
                                      ? "最後の有効な教室長は無効化できません"
                                      : undefined
                                }
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
                                {isSelf
                                  ? "自分自身の有効/無効は変更できません。"
                                  : wouldBeLastActive
                                    ? "最後の有効な教室長のため無効化できません（別の教室長を有効化してください）。"
                                    : t.isAdmin
                                      ? "教室長兼任のため、無効化すると教室長としてもログインできなくなります（削除はできません）。"
                                      : "無効化するとログインできなくなります（削除はできません）。"}
                              </span>
                            </div>
                          </>
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
