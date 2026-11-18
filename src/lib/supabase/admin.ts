import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isVercelPreview } from "@/db/connection-url";

/**
 * service_role キーを使う管理用クライアント。
 * RLS を貫通するためサーバー (Server Action / Route Handler) からのみ使用。
 * 絶対にクライアントへ漏らさないこと。
 */
export function createAdminClient() {
  // プレビューの環境変数には本番の service_role キーが入っているので使わない
  if (isVercelPreview()) {
    throw new Error("プレビュー環境では管理者用のキーを使いません");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE 環境変数が未設定です (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
