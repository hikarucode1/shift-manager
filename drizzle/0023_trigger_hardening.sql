-- #98 + #99: 0015 / 0022 trigger 関数の hardening。
-- 機能変化なし、防御線の意図を明示する文書化と将来の schema 拡張への備え。
--
-- #98: 0022 trigger 内の `IF p_start IS NULL THEN ... foreign_key_violation` 分岐は、
-- period_id が NOT NULL + FK で守られているため実質 dead code。`foreign_key_violation`
-- errcode が呼び出し側に「FK 不整合 = 同時実行で参照先が消えた」と誤解させる懸念が
-- あったので、コメントで「defensive only、constraints が緩むまで unreachable」と明示
-- する (errcode 自体は変えない、案 A 採用)。
--
-- #99: trigger 関数に `SET search_path = public, pg_temp` を付ける。本プロジェクトは
-- public 単一 schema 運用で現状実害なしだが、将来 schema を追加した場合や、
-- search_path を変更するクライアントから trigger が予期せぬ table を参照するのを防ぐ
-- 一般的な best practice。0015 / 0022 の 3 関数すべてに付ける。
--
-- 関数本体の差し替えのみで TRIGGER 本体は触らない (CREATE OR REPLACE FUNCTION で OK)。

CREATE OR REPLACE FUNCTION validate_shift_submission_status_transition()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- BEFORE UPDATE OF status トリガなので UPDATE 文の SET 句に status が含まれる
  -- 時のみ発火する (メタ列のみの UPDATE は素通し)。さらに同一状態の再代入も
  -- 無条件で許容して、アプリ側で「状態とメタを同時に書く」パターンを単純化する。
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status = 'draft' AND NEW.status IN ('submitted', 'frozen'))
     OR (OLD.status = 'submitted' AND NEW.status IN ('draft', 'frozen'))
     OR (OLD.status = 'frozen' AND NEW.status = 'draft')
  THEN
    -- frozen → draft の場合、submitted_at をクリアして CHECK 制約
    -- (fixed_shift_submissions_status_submitted_at_chk: draft は submitted_at
    -- IS NULL) と整合させる。アプリ層 (actions.ts:setSubmissionFrozen) でも
    -- 同じことを行うが、生 SQL / service_role 経路で submitted_at を残したまま
    -- 遷移されても CHECK 違反でなく説明的な NULL 上書きとして処理する。
    IF OLD.status = 'frozen' AND NEW.status = 'draft' THEN
      NEW.submitted_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Invalid shift submission status transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_course_confirmation_date_in_period()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  p_start DATE;
  p_end DATE;
BEGIN
  SELECT start_date, end_date INTO p_start, p_end
    FROM periods WHERE id = NEW.period_id;
  -- Defensive only: period_id is NOT NULL + FK so this branch is unreachable
  -- in practice. Kept as a guardrail in case those constraints are ever relaxed.
  IF p_start IS NULL THEN
    RAISE EXCEPTION 'course_confirmations.period_id % not found', NEW.period_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.date < p_start OR NEW.date > p_end THEN
    RAISE EXCEPTION
      'course_confirmations.date % is outside period range [%, %]',
      NEW.date, p_start, p_end
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

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
  IF NEW.effective_to IS NOT NULL AND
     (NEW.effective_to < p_start OR NEW.effective_to > p_end) THEN
    RAISE EXCEPTION
      'regular_assignments.effective_to % is outside period range [%, %]',
      NEW.effective_to, p_start, p_end
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
