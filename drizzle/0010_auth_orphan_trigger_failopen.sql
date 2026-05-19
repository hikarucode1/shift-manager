-- handle_auth_user_deleted を fail-open 化 (Issue #23 レビュー E3)
--
-- AFTER DELETE ON auth.users のフック関数が例外を投げると、auth user
-- 削除文ごとロールバックされ「auth ユーザーを削除できない」状態になる。
-- Supabase の認証フローへのフックである以上「自分のフックが auth 運用を
-- 壊さない」を最優先とし、UPDATE 失敗時も削除は止めない (fail-open)。
-- 掃除漏れは scripts/check-auth-orphans.ts が安全網になる。
--
-- CREATE OR REPLACE のためトリガ (on_auth_user_deleted) は再作成不要
-- (名前で関数に束縛され続ける)。

CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE public.profiles
    SET auth_user_id = NULL, updated_at = now()
    WHERE auth_user_id = OLD.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_auth_user_deleted failed for %: %', OLD.id, SQLERRM;
  END;
  RETURN OLD;
END;
$$;
