/**
 * #318: ブラウザ側の Web Push の下回り (純粋関数はテストできるよう分けておく)。
 */

export type PushSupport = "supported" | "ios-browser" | "unsupported";

type Env = {
  userAgent: string;
  /** ホーム画面から開いているか (display-mode: standalone / navigator.standalone) */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
};

export function isIos(userAgent: string): boolean {
  // iPadOS 13 以降の Safari は Mac と名乗るので拾えないが、講師は iPhone で
  // 使う前提。iPad は Push の有無で supported / unsupported に落ちる
  return /iPhone|iPad|iPod/.test(userAgent);
}

export function detectPushSupport(env: Env): PushSupport {
  // iPhone の Safari (ホーム画面に追加していない) では PushManager が無い。
  // 「使えない」ではなく「追加すれば使える」と案内する
  if (isIos(env.userAgent) && !env.standalone) return "ios-browser";
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) {
    return "supported";
  }
  return "unsupported";
}

export function pushSupportState(): PushSupport {
  return detectPushSupport({
    userAgent: navigator.userAgent,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  });
}

/** VAPID 公開鍵 (base64url) → subscribe に渡す Uint8Array */
export function urlBase64ToUint8Array(
  base64Url: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
