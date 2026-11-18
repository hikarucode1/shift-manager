import type { NextConfig } from "next";

/**
 * 全ページ・全 API に付けるセキュリティヘッダー。
 * - 他サイトの iframe にこのアプリを埋め込ませない (クリックジャッキング対策)。
 *   古いブラウザ向けの X-Frame-Options と、今の標準の frame-ancestors の両方
 * - nosniff: ブラウザに中身から種類を推測させない
 * - Referrer-Policy: 外部サイトへはオリジンだけを伝え、パスや ID は渡さない
 * - Permissions-Policy: 使っていないカメラ・マイク・位置情報を止める
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
