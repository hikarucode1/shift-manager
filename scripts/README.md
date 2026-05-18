# scripts/

DB の確認・初期化用の tsx スクリプト集。`.env.local` の `DATABASE_URL` / `SUPABASE_*` を使う。

実行方法:
```bash
npx tsx scripts/<filename>.ts [args]
```

## 一覧

| ファイル | 用途 |
|---|---|
| `check-tables.ts` | `public` スキーマのテーブル一覧を表示 |
| `check-seed.ts` | `slot_definitions` と `profiles` の中身確認 |
| `check-auth.ts` | `auth.users` × `profiles` の紐付き状態を確認 |
| `check-upload.ts` | 直近の `shift_uploads` と関連テーブルの集計 |
| `reset-password.ts <email> <new-pw>` | パスワードを直接リセット (pgcrypto bcrypt cost 10) |
| `seed-stub-tutors.ts <csv-path>` | CSV から一意な講師名を抽出し、未登録の名前を `profiles` に追加（テスト用、auth は無し） |
| `test-parser.ts <csv-path>` | 座席表 CSV パーサーの単体動作確認 |
| `check-rls-migrations.ts` | **静的 RLS ガード（CI）**: drizzle/*.sql を解析し、CREATE TABLE した全 public テーブルに RLS+REVOKE 宣言があるか検証（DB 非接続）。`npm run check:rls` |
| `check-rls.ts` | **ライブ RLS チェック**: 実 DB の `rowsecurity` と anon/authenticated 残存権限を検査（要 DB 接続）|
| `check-auth-orphans.ts [--fix]` | `auth_user_id` が `auth.users` に無い孤児 profile を検出（`--fix` で NULL 化＝未連携へ戻す）。0009 トリガ導入後は新規発生なし、legacy 用 |

## 注意

- これらは **開発・運用補助用**。本番ロジックには含めない
- `reset-password.ts` / `seed-stub-tutors.ts` は DB を直接書き換える → 実行前に対象を確認すること
- ESLint 対象外 (`eslint.config.mjs` で `scripts/**` を ignore 済み)
