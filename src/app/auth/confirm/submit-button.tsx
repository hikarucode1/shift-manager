"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * 送信中は押せなくする。招待リンクは 1 回しか使えないので、二度押しすると
 * 2 回目が使用済み (otp_expired) で弾かれ、その redirect が後から勝つと
 * ログインできているのに「招待リンクを使えません」と出る。
 */
export function ConfirmSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "確認中..." : "パスワードの設定へ進む"}
    </Button>
  );
}
