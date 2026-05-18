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

admin ユーザーは **Authentication > Users > Add user**（Auto Confirm User を ON）で作成し、
表示される **User UID** を控えて `profiles` に対応行を追加:

```sql
insert into profiles (id, display_name, role, email) values
  ('<コピーした User UID>', '教室長', 'admin', 'admin@example.com');
```

テスト用に CSV の講師名を一括登録したい場合は
[`scripts/README.md`](./scripts/README.md) の `seed-stub-tutors.ts` を参照。

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

### RLS（適用済み: migration 0007 / Issue #11）

データアクセスは全て **サーバー仲介**（Server Component / Server Action が
`requireRole` で認可 → Drizzle が `postgres` ロールで実行）。`postgres` は
`BYPASSRLS=true` かつ全 public テーブルの owner。一方クライアント側で
公開される anon キーは **GoTrue 認証専用**で、アプリテーブルを JWT で
直接参照しない。

この構成に対し migration `0007_rls.sql` で全 public テーブルに:

- `ENABLE ROW LEVEL SECURITY`
- `REVOKE ALL ... FROM anon, authenticated`

を適用。結果:

- anon/authenticated の PostgREST 直アクセス（`/rest/v1/...`）は
  `permission denied` で**完全遮断**（公開 anon キー悪用による PII 漏洩を解消）
- アプリ側 Drizzle クエリ（`postgres` / BYPASSRLS+owner）は無影響
- ログイン（GoTrue / `auth` スキーマ）も無影響

> 細粒度の per-row ポリシー（講師は自分の行のみ等）は、クライアント直 DB
> アクセスを導入するまで実行されない dead code になるため意図的に未実装。
> 将来 Supabase クライアントから直接データ取得する場合に追加する。
>
> ⚠️ **新規 public テーブルを追加したら同様に RLS 有効化 + REVOKE すること**
> （Supabase の default privileges で anon に再付与され得るため）。

### auth.users 削除との整合（migration 0009 / Issue #23）

`profiles.auth_user_id` は `auth.users` への FK を貼らない方針のため、
auth user を削除すると参照が宙に浮く。migration `0009` の
`AFTER DELETE ON auth.users` トリガが該当 profile の `auth_user_id` を
NULL に戻し、**「未連携(stub)」状態へ正規化**する。これにより教室長は
`/admin/tutors` で「未連携」として把握でき、「招待」から再連携（復旧）できる。

トリガ導入前に削除された legacy 孤児は
`tsx scripts/check-auth-orphans.ts [--fix]` で検出・復旧する。

### 確定シフト Excel

既存 Excel フォーマットに合わせて `exceljs` でパーサーを書きます。
サンプルを受領後 `src/lib/excel-parser.ts` を実装予定。

---

## デプロイ（Vercel）

GitHub 連携で main を本番、PR を Preview Deploy にする。

### 1. Vercel プロジェクト作成

1. [Vercel](https://vercel.com) で GitHub リポジトリ `eisai-manager` を Import
2. Framework は Next.js が自動検出（`vercel.json` で明示済み）
3. Functions のリージョンは `vercel.json` で **`hnd1`（東京）** 固定
   — Supabase が ap-northeast-1 のため DB レイテンシ最小化

### 2. 環境変数（Vercel > Settings > Environment Variables）

`.env.local.example` と同じ **4 つ**を **Production / Preview 両方**に設定:

| Key | 値 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co`（`/rest/v1/` を付けない） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role（**サーバー専用・公開しない**） |
| `DATABASE_URL` | Transaction pooler (6543) の URI |

> ⚠️ **`TZ` は Vercel では設定しない**（予約変数のため `invalid` で拒否される）。
> 本アプリは OS の `TZ` に依存しない設計 — 週計算は固定 +9h オフセット、
> `toLocale*` は全て `timeZone: "Asia/Tokyo"` を明示、締切は絶対時刻保存。
> Vercel 関数が UTC でも JST ロジックは正しく動く。
>
> DB は全ページ動的・ビルド時非接続。Transaction pooler はサーバーレス
> （短命関数）に適合（`prepare: false` 設定済み）。

### 3. Supabase 側 URL 設定（Authentication > URL Configuration）

招待 / パスワード再設定リンクとリダイレクトのため:

- **Site URL**: 本番 URL（例 `https://eisai-manager.vercel.app`）
- **Redirect URLs**: 本番 URL と Preview ワイルドカード
  （例 `https://eisai-manager-*.vercel.app/**`）を追加

### 4. デプロイ後の確認

- 公開 URL → `/login` → admin ログイン → 各画面操作
- スマホ実機で講師フロー（今週シフト・希望提出・申請）
- PR を出すと Preview URL が生成されること

### 注意

- **RLS migration（0007）は本番 DB に適用済みであること**を確認
  （未適用なら anon キーで PII 漏洩。`scripts/` で確認可）
- スキーマ変更を伴う PR は、デプロイ前に該当 Supabase へ
  `npm run db:migrate` を実行（Vercel ビルドは migration を実行しない）
- Next.js 16 の `middleware.ts` は将来 `proxy` へ要改名（現状は警告のみ・動作可）

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
