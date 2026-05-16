import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * service_role キーを使う管理用クライアント。
 * RLS を貫通するためサーバー (Server Action / Route Handler) からのみ使用。
 * 絶対にクライアントへ漏らさないこと。
 */
export function createAdminClient() {
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
