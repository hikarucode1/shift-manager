"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN_LENGTH } from "@/lib/invite-link";
import { setPassword, type SetPasswordState } from "./actions";

export function SetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<
    SetPasswordState,
    FormData
  >(setPassword, null);
  // ⚠️ 入力は state で持つ。`<form action>` は送信のたびに React がフォームを
  // リセットし、非制御の input だとエラー表示後に打ち直した値が送信直前に
  // 空へ戻って required で止まる (Playwright で実測)。
  const [password, setPasswordValue] = useState("");
  const [confirmation, setConfirmation] = useState("");

  return (
    <form className="space-y-4" action={formAction}>
      {/* パスワードマネージャーが「どのアカウントの」パスワードか紐付けるため */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />
      <div className="space-y-2">
        <Label htmlFor="password">新しいパスワード</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          value={password}
          onChange={(e) => setPasswordValue(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {PASSWORD_MIN_LENGTH}文字以上
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmation">もう一度入力</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "保存中..." : "保存してはじめる"}
      </Button>
    </form>
  );
}
