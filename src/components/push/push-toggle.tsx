"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, Share } from "lucide-react";
import { toFailedResult } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deletePushSubscription,
  savePushSubscription,
} from "@/app/push/actions";
import { pushSupportState, urlBase64ToUint8Array } from "@/lib/push-client";

/**
 * #318: スマホ通知 (Web Push) の ON / OFF。講師・教室長の通知画面に置く。
 *
 * 状態:
 * - `ios-browser` … iPhone の Safari で開いている。ホーム画面に追加しないと
 *   届かない (iOS の制限) ので、追加の手順を出す
 * - `unsupported` … このブラウザでは使えない
 * - `denied` … 端末で通知をブロックしている
 * - `off` / `on`
 */

type State =
  | "loading"
  | "ios-browser"
  | "unsupported"
  | "denied"
  | "off"
  | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

async function getRegistration() {
  return navigator.serviceWorker.register("/sw.js");
}

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!VAPID_PUBLIC_KEY) return;
      const support = pushSupportState();
      if (support !== "supported") {
        if (!cancelled) setState(support);
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      try {
        const reg = await getRegistration();
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          // サーバー側の行が消えていても (期限切れ判定・DB の作り直し) 付け直す
          await savePushSubscription({
            ...sub.toJSON(),
            userAgent: navigator.userAgent,
          }).catch(toFailedResult);
        }
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 本番に鍵を入れるまでは出さない (押しても何も届かないため)
  if (!VAPID_PUBLIC_KEY) return null;

  function turnOn() {
    setError(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await getRegistration();
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        const res = await savePushSubscription({
          ...sub.toJSON(),
          userAgent: navigator.userAgent,
          sendTest: true,
        }).catch(toFailedResult);
        if (!res.ok) {
          await sub.unsubscribe().catch(() => {});
          setError(res.error);
          return;
        }
        setState("on");
      } catch {
        setError("ON にできませんでした。時間をおいてお試しください。");
      }
    });
  }

  function turnOff() {
    setError(null);
    startTransition(async () => {
      try {
        const reg = await getRegistration();
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const res = await deletePushSubscription({
            endpoint: sub.endpoint,
          }).catch(toFailedResult);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          await sub.unsubscribe();
        }
        setState("off");
      } catch {
        setError("OFF にできませんでした。時間をおいてお試しください。");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4" />
          スマホ通知
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state === "loading" && (
          <p className="text-muted-foreground">確認しています…</p>
        )}

        {state === "ios-browser" && (
          <div className="space-y-2">
            <p>
              iPhone
              では、ホーム画面に追加したアプリからだけ通知を受け取れます。
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                画面下の共有ボタン
                <Share className="mx-1 inline size-4 align-text-bottom" />
                を押す
              </li>
              <li>「ホーム画面に追加」を選ぶ</li>
              <li>追加したアイコンから開き、この画面で ON にする</li>
            </ol>
          </div>
        )}

        {state === "unsupported" && (
          <p className="text-muted-foreground">
            このブラウザではスマホ通知を使えません。通知はこの画面とベルで確認してください。
          </p>
        )}

        {state === "denied" && (
          <p className="text-muted-foreground">
            この端末で通知がブロックされています。端末の設定でこのアプリの通知を許可すると、ON
            にできます。
          </p>
        )}

        {state === "off" && (
          <>
            <p className="text-muted-foreground">
              ON にすると、ベルに出るお知らせがこの端末にも届きます。
            </p>
            <Button className="w-full" disabled={isPending} onClick={turnOn}>
              {isPending ? "設定中..." : "この端末で通知を受け取る"}
            </Button>
          </>
        )}

        {state === "on" && (
          <>
            <p>この端末に通知が届きます。</p>
            <Button
              variant="outline"
              className="w-full"
              disabled={isPending}
              onClick={turnOff}
            >
              {isPending ? "設定中..." : "この端末の通知をやめる"}
            </Button>
          </>
        )}

        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
