-- Issue #87 follow-up (本 PR 内 P2-2):
-- 0023 hardening 版の `validate_regular_assignment_range_in_period` は
-- `IF NEW.effective_to IS NOT NULL AND ...` で NULL 分岐を持っていたが、
-- 0024 で effective_to が NOT NULL になったため左条件は常に true となり
-- dead code 化する。コメントも 0022 由来の「NULL の場合はチェック対象外」が
-- 現実と矛盾する。
--
-- ここでは `CREATE OR REPLACE FUNCTION` で本体を差し替え、NULL 分岐を除去
-- する。検証ロジック (range 比較) と RAISE 形式は 0023 hardening 版を維持。
-- 0015 / 0022 の他 2 関数は本 PR の対象外 (NULL 想定無し)。
CREATE OR REPLACE FUNCTION validate_regular_assignment_range_in_period()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  p_start DATE;
  p_end DATE;
BEGIN
  SELECT start_date, end_date INTO p_start, p_end
    FROM regular_shift_periods WHERE id = NEW.period_id;
  -- Defensive only: period_id is NOT NULL + FK so this branch is unreachable
  -- in practice. Kept as a guardrail in case those constraints are ever relaxed.
  IF p_start IS NULL THEN
    RAISE EXCEPTION 'regular_assignments.period_id % not found', NEW.period_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.effective_from < p_start OR NEW.effective_from > p_end THEN
    RAISE EXCEPTION
      'regular_assignments.effective_from % is outside period range [%, %]',
      NEW.effective_from, p_start, p_end
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.effective_to < p_start OR NEW.effective_to > p_end THEN
    RAISE EXCEPTION
      'regular_assignments.effective_to % is outside period range [%, %]',
      NEW.effective_to, p_start, p_end
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
