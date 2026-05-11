# eisai-manager

英才個別学院 東武練馬校 シフト管理システム。
講師・教室長がスマホ / PC から使える Web アプリです。

UI 仕様書は [`docs/eisai-manager_UI仕様書.pdf`](./docs/) にあります。

---

## 機能概要

- **講師**: 固定シフト登録（曜日 × コマ）、講習期間の日別希望提出、欠勤・交代申請、代講募集への応募
- **教室長**: 講師管理、期間（通常 / 講習）と締切の設定、希望の俯瞰、
  **確定シフト Excel のアップロード・公開**、申請の承認

---

## 技術スタック

| 層 | 採用 |
|---|---|
| フレームワーク | Next.js 16 (App Router, TypeScript, Turbopack) |
| UI | Tailwind CSS v4 + shadcn/ui (new-york) + lucide-react |
| フォーム / バリデーション | react-hook-form + zod |
| 認証 / ストレージ | Supabase (Auth + Storage + Postgres) |
| DB アクセス | Drizzle ORM (postgres-js driver) |
| Excel 読み取り | exceljs |
| 日付 | date-fns / date-fns-tz (JST 固定) |

---

## セットアップ

### 1. 依存インストール

```bash
npm install
```

### 2. Supabase プロジェクト準備

1. [Supabase](https://supabase.com) で新規プロジェクト作成（リージョン: `Northeast Asia (Tokyo)` 推奨）
2. Project Settings > API から以下を取得
   - **Project URL**: `https://<project-ref>.supabase.co`
     ⚠️ 末尾の `/rest/v1/` を含めない（含めると Auth が PostgREST に流れて 404 になる）
   - anon public key
   - service_role key
3. Project Settings > Database > Connection string > **Transaction pooler** タブの URI を控える（ポート 6543）

### 3. 環境変数

```bash
cp .env.local.example .env.local
```

`.env.local` を編集して上記 4 つの値を設定。`DATABASE_URL` のパスワード部分 `[YOUR-PASSWORD]` を実際のパスワードに置換するのを忘れずに。

> Next.js も Drizzle CLI も `.env.local` を読みます。`.env` ではないので注意。

### 4. DB マイグレーション

```bash
# スキーマから SQL を生成（既に generate 済みなら不要）
npm run db:generate

# 適用
npm run db:migrate
```

### 5. 初期データ投入

Supabase ダッシュボードの **SQL Editor** で実行:

```sql
insert into slot_definitions (slot_number, label, start_time, end_time) values
  (1, '1限', '09:30', '10:55'),
  (2, '2限', '11:00', '12:25'),
  (3, '3限', '12:30', '13:55'),
  (4, '4限', '14:00', '15:25'),
  (5, '5限', '15:30', '16:55'),
  (6, '6限', '17:00', '18:25'),
  (7, '7限', '18:30', '19:55'),
  (8, '8限', '20:00', '21:25');
```

admin ユーザーは **Authentication > Users > Add user** で作成後、`profiles` に対応する行を `role = 'admin'` で追加。
詳細は [`scripts/README.md`](./scripts/README.md) の `seed-stub-tutors.ts` なども参照。

### 6. 開発サーバー

```bash
npm run dev
```

http://localhost:3000 を開くと `/login` にリダイレクトされます。
Supabase Auth で作成したユーザーに対し、`profiles` テーブルへ
`role = 'admin'` で手動登録するとダッシュボードに入れます。

---

## ディレクトリ構成

```
src/
├─ app/                    # Next.js App Router
│  ├─ login/               # ログイン画面
│  ├─ auth/signout/        # POST /auth/signout でサインアウト
│  ├─ tutor/               # 講師用ページ (layout でガード)
│  └─ admin/               # 教室長用ページ (layout でガード)
├─ components/
│  ├─ app-shell.tsx        # ヘッダー + ナビ + 本文レイアウト
│  └─ ui/                  # shadcn/ui プリミティブ
├─ db/
│  ├─ client.ts            # Drizzle + postgres-js
│  └─ schema.ts            # 全テーブル定義
├─ lib/
│  ├─ auth.ts              # requireSession / requireRole
│  ├─ shift-constants.ts   # 曜日・コマ定義
│  ├─ supabase/            # ブラウザ / サーバー / middleware
│  └─ utils.ts             # cn() ヘルパー
└─ middleware.ts           # セッション更新 + 未ログインリダイレクト
```

---

## 運用上の補足

### ロール判定

- 認証は Supabase Auth、権限は `profiles.role`（`tutor` / `admin`）
- 各ロールのページは `src/app/{tutor,admin}/layout.tsx` 内の `requireRole` でガード
- ロール不一致時は自分のホームへリダイレクト

### RLS

本 scaffold ではアプリ層（Drizzle）で絞り込みを行いますが、
本番運用時は Postgres の Row Level Security (RLS) を以下方針で有効化推奨:

- `profiles`: 自分自身のみ参照可。admin のみ書き込み可
- `fixed_shifts` / `training_preferences` / `absence_requests` / `swap_requests`:
  作成者 (`tutor_id` / `requester_id`) のみ参照・更新可。admin は全件参照可
- `weekly_shifts`: 公開済みのものは全員参照可。admin のみ書き込み可

### 確定シフト Excel

既存 Excel フォーマットに合わせて `exceljs` でパーサーを書きます。
サンプルを受領後 `src/lib/excel-parser.ts` を実装予定。

---

## スクリプト

| コマンド | 用途 |
|---|---|
| `npm run dev` | 開発サーバー (Turbopack) |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番サーバー |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Drizzle マイグレーション SQL 生成 |
| `npm run db:push` | スキーマを DB に反映 |
| `npm run db:migrate` | 生成済みマイグレーションを適用 |
| `npm run db:studio` | Drizzle Studio GUI |

---

## ロードマップ

- [x] 基盤: Next.js + Tailwind + shadcn/ui
- [x] Supabase 認証 & ロールガード
- [x] Drizzle スキーマ (profiles / periods / shifts / uploads / requests)
- [x] 講師: 固定シフト登録
- [ ] 講師: 講習希望提出
- [ ] 講師: 欠勤申請
- [ ] 講師: 交代 / 代講申請・応募
- [ ] 教室長: 期間管理・講師管理
- [ ] 教室長: 希望俯瞰（ヒートマップ）
- [ ] 教室長: **Excel アップロード & プレビュー & 公開**
- [ ] 教室長: 申請承認
- [ ] RLS ポリシー適用
- [ ] Vercel デプロイ
