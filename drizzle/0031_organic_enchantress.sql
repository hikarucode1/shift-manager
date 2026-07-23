ALTER TABLE "fixed_shift_submissions" ADD CONSTRAINT "fixed_shift_submissions_effective_range_chk" CHECK ("fixed_shift_submissions"."effective_to" IS NULL OR "fixed_shift_submissions"."effective_to" >= "fixed_shift_submissions"."effective_from");--> statement-breakpoint
-- #165: training_preferences.date が紐付く期 (periods) の範囲内か DB 層 trigger で
-- 強制する。course_confirmations (0022) と同型。アプリ (setTrainingSlot) で検証済み
-- だが、service_role 直接 SQL 等の bypass 経路を塞ぐ最終防御。新規関数なので
-- search_path は最初から固定 (0023 の hardening 方針)。
CREATE OR REPLACE FUNCTION validate_training_preference_date_in_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  p_start DATE;
  p_end DATE;
BEGIN
  SELECT start_date, end_date INTO p_start, p_end
    FROM periods WHERE id = NEW.period_id;
  IF p_start IS NULL THEN
    RAISE EXCEPTION 'training_preferences.period_id % not found', NEW.period_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.date < p_start OR NEW.date > p_end THEN
    RAISE EXCEPTION
      'training_preferences.date % is outside period range [%, %]',
      NEW.date, p_start, p_end
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS training_preferences_date_in_period_trg ON training_preferences;
--> statement-breakpoint
CREATE TRIGGER training_preferences_date_in_period_trg
  BEFORE INSERT OR UPDATE OF date, period_id ON training_preferences
  FOR EACH ROW
  EXECUTE FUNCTION validate_training_preference_date_in_period();
--> statement-breakpoint
-- #165: 0010 の SECURITY DEFINER 関数の search_path を 0023 と同じ
-- `public, pg_temp` に揃える (pg_temp を明示末尾に置き temp オブジェクトによる
-- 参照シャドウを防ぐ hardening)。0023 の対象から漏れていた。
-- CREATE OR REPLACE なので trigger (on_auth_user_deleted) の再作成は不要。
CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
