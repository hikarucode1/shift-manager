-- Issue #176: 親 period の start_date / end_date 縮小時、範囲外に取り残される
-- training_preferences.date を BEFORE UPDATE trigger で検出する。
--
-- 0026 で course_confirmations について同じ対を入れたが、training_preferences は
-- 子側 (0031: INSERT/UPDATE 時の範囲チェック) しか無く、**親側が空いていた**。
-- そのため「期を縮めて範囲外の講習希望を取り残す」経路が DB 層・アプリ層とも
-- 素通りする状態だった。
--
-- 0026 と同型: search_path を public, pg_temp に固定し、start_date / end_date の
-- 実値が変わらない UPDATE (updated_at だけ等) は IS DISTINCT FROM で早期 return
-- して無用な child SELECT を避ける。
CREATE OR REPLACE FUNCTION validate_period_range_covers_training_preferences()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  violator_date DATE;
BEGIN
  IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
    RETURN NEW;
  END IF;
  SELECT date INTO violator_date
    FROM training_preferences
    WHERE period_id = NEW.id
      AND (date < NEW.start_date OR date > NEW.end_date)
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'training_preferences.date % is outside period range [%, %]',
      violator_date, NEW.start_date, NEW.end_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS periods_range_covers_training_preferences_trg ON periods;--> statement-breakpoint
CREATE TRIGGER periods_range_covers_training_preferences_trg
  BEFORE UPDATE OF start_date, end_date ON periods
  FOR EACH ROW
  EXECUTE FUNCTION validate_period_range_covers_training_preferences();
