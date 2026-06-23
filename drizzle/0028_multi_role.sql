-- #111: profiles.role (単一 user_role) を roles (user_role[]) に置換し兼任を可能にする。
-- 既存の単一 role を ARRAY[role] で backfill して意味を保存する。
-- 順序: roles 追加 → backfill → 旧 partial index 削除 → role 列削除 → 新 index 作成。
-- ※ partial unique index は role 列に依存するため、列削除前に明示 DROP し、roles 述語で再作成する。
ALTER TABLE "profiles" ADD COLUMN "roles" "user_role"[] DEFAULT '{"tutor"}' NOT NULL;--> statement-breakpoint
UPDATE "profiles" SET "roles" = ARRAY["role"]::"user_role"[];--> statement-breakpoint
DROP INDEX "profiles_tutor_name_uniq";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "role";--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_tutor_name_uniq" ON "profiles" USING btree ("display_name") WHERE 'tutor' = ANY("profiles"."roles");
