-- C1 #62: 固定シフト提出の状態遷移を DB 層で二重防御する trigger。
-- アプリ層 (src/lib/shift-submission-state.ts) で同じルールを持つが、
-- service_role 直接 SQL / CSV import / 将来の他クライアント等の bypass
-- 経路から不正遷移が入るのを最終防御する。
--
-- 許可される遷移:
--   draft → submitted   (講師 submit)
--   draft → frozen      (admin force-freeze)
--   submitted → draft   (講師 revert / admin が下書き化)
--   submitted → frozen  (admin force-freeze)
--   frozen → draft      (admin unfreeze)
--
-- 拒否:
--   frozen → submitted  (admin が解除する場合は一度 draft に戻し、講師の
--                         再 submit を強制する。「いつの提出か」を曖昧にしない)

CREATE OR REPLACE FUNCTION validate_shift_submission_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- 同一状態への UPDATE (メタ列のみ変更) は素通し
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status = 'draft' AND NEW.status IN ('submitted', 'frozen'))
     OR (OLD.status = 'submitted' AND NEW.status IN ('draft', 'frozen'))
     OR (OLD.status = 'frozen' AND NEW.status = 'draft')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Invalid shift submission status transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS fixed_shift_submissions_status_transition_trg ON fixed_shift_submissions;
--> statement-breakpoint
CREATE TRIGGER fixed_shift_submissions_status_transition_trg
  BEFORE UPDATE OF status ON fixed_shift_submissions
  FOR EACH ROW
  EXECUTE FUNCTION validate_shift_submission_status_transition();
