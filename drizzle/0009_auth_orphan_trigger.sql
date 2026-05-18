-- auth.users 削除時の profiles.auth_user_id 孤児化を防ぐ (Issue #23)
--
-- profiles.auth_user_id は auth.users への FK を持たない (スキーマ全体が
-- cross-schema FK を避ける方針)。Supabase ダッシュボード等で auth user を
-- 削除すると auth_user_id が宙に浮き、ログイン不可なのに「連携済み」表示が
-- 残る。AFTER DELETE トリガで該当 profile の auth_user_id を NULL に戻し、
-- 既存の「未連携(stub)」状態へ正規化する。これにより #5/#22 の「招待」
-- 再連携フローがそのまま復旧手段になる (新規 UI 不要)。

CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET auth_user_id = NULL, updated_at = now()
  WHERE auth_user_id = OLD.id;
  RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;--> statement-breakpoint

CREATE TRIGGER on_auth_user_deleted
AFTER DELETE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_deleted();
