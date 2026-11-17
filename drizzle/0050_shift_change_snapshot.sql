-- #333: 承認したときの控え (期限切れで元に戻す用)。テーブルは 0049 で RLS + REVOKE 済み
ALTER TABLE "shift_change_requests" ADD COLUMN "regular_snapshot" jsonb;