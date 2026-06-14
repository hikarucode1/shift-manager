-- Issue #97: 親 period の start_date / end_date 変更時、既存 child rows が
-- 新 range から外れることを BEFORE UPDATE trigger で検出する。
--
-- 既に 0022 (+ 0023/0025 hardening) で child 側 INSERT/UPDATE 時の親 range
-- チェックは追加済み。本 migration はその対の片割れで、親 UPDATE 時に
-- child 範囲外を検出する経路を埋める。アプリ層 `updatePeriod` /
-- `updateRegularPeriod` で同等チェックがあるが、service_role 直接 SQL や
-- 将来の bypass 経路に対する DB 層 guardrail。
--
-- search_path は 0023 hardening と同じく public, pg_temp に固定。
-- start_date / end_date の実値が変わらない UPDATE (updated_at だけ等) は
-- IS DISTINCT FROM チェックで早期 return し、無用な child SELECT を避ける。

-- ============================================================
-- periods 側: child = course_confirmations.date
-- ============================================================
CREATE OR REPLACE FUNCTION validate_period_range_covers_course_confirmations()
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
    FROM course_confirmations
    WHERE period_id = NEW.id
      AND (date < NEW.start_date OR date > NEW.end_date)
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'course_confirmations.date % is outside period range [%, %]',
      violator_date, NEW.start_date, NEW.end_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS periods_range_covers_course_confirmations_trg ON periods;--> statement-breakpoint
CREATE TRIGGER periods_range_covers_course_confirmations_trg
  BEFORE UPDATE OF start_date, end_date ON periods
  FOR EACH ROW
  EXECUTE FUNCTION validate_period_range_covers_course_confirmations();
--> statement-breakpoint

-- ============================================================
-- regular_shift_periods 側: child = regular_assignments.effective_from / effective_to
-- (effective_to は #87 / 0024 で NOT NULL 化済み、NULL 分岐不要)
-- ============================================================
CREATE OR REPLACE FUNCTION validate_regular_shift_period_range_covers_assignments()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  violator_from DATE;
  violator_to DATE;
BEGIN
  IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
    RETURN NEW;
  END IF;
  SELECT effective_from, effective_to INTO violator_from, violator_to
    FROM regular_assignments
    WHERE period_id = NEW.id
      AND (effective_from < NEW.start_date
           OR effective_from > NEW.end_date
           OR effective_to < NEW.start_date
           OR effective_to > NEW.end_date)
    LIMIT 1;
  IF FOUND THEN
    IF violator_from < NEW.start_date OR violator_from > NEW.end_date THEN
      RAISE EXCEPTION
        'regular_assignments.effective_from % is outside period range [%, %]',
        violator_from, NEW.start_date, NEW.end_date
        USING ERRCODE = 'check_violation';
    ELSE
      RAISE EXCEPTION
        'regular_assignments.effective_to % is outside period range [%, %]',
        violator_to, NEW.start_date, NEW.end_date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS regular_shift_periods_range_covers_assignments_trg ON regular_shift_periods;--> statement-breakpoint
CREATE TRIGGER regular_shift_periods_range_covers_assignments_trg
  BEFORE UPDATE OF start_date, end_date ON regular_shift_periods
  FOR EACH ROW
  EXECUTE FUNCTION validate_regular_shift_period_range_covers_assignments();
