import type { MetadataRoute } from "next";

/**
 * #318: ホーム画面に追加できるようにする (PWA)。iPhone は**ホーム画面に追加した
 * ときだけ** Web Push が届く (iOS 16.4 以降) ので、Push の前提になる。
 *
 * ⚠️ `/manifest.webmanifest` は middleware の認証から外している
 * (`src/middleware.ts`)。ブラウザは manifest を cookie なしで取りに来るので、
 * 認証を通すと /login へ飛ばされて読み込めない。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shift Manager | シフト管理",
    short_name: "シフト管理",
    description: "個別指導塾向けのシフト管理システム",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    // layout.tsx の viewport.themeColor (primary のネイビー) と揃える
    theme_color: "#1b2a64",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
