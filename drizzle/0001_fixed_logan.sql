ALTER TABLE "profiles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "auth_user_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_auth_user_id_unique" UNIQUE("auth_user_id");--> statement-breakpoint
-- Backfill: 既存は profiles.id == auth.users.id 前提だったため、
-- auth.users に同 ID が居る行は auth_user_id = id を埋める。
-- (これを行わないと auth_user_id 基準のログイン解決で既存ユーザーが弾かれる)
UPDATE "profiles" p
SET "auth_user_id" = p."id"
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p."id");