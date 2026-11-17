// #318: Web Push を受けて通知を出す Service Worker。
//
// ⚠️ fetch は横取りしない (オフライン対応はしない)。キャッシュを持つと、
// デプロイ後も古い画面が出続ける事故が起きるため。ここでやるのは Push だけ。
// ⚠️ `/sw.js` は middleware の認証から外している (`src/middleware.ts`)。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Shift Manager";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // 同じ通知が二重に届いたときに 1 件にまとめる
      tag: data.tag || undefined,
      data: { href: data.href || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  const url = new URL(href, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // 開いているアプリがあればそれを使う (ホーム画面のアプリが 2 つ開かないように)
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
