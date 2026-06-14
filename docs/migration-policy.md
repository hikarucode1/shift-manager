# Migration ポリシー

drizzle migration をどのタイミングで本番 (Supabase) に流すか、どの migration が破壊的かを記録する。

## 環境構成

- 本番 (production): `.env.local` の `DATABASE_URL` が指す Supabase Postgres
- staging / preview: 無し。本番が唯一の DB
- 適用コマンド: `npm run db:migrate` (drizzle-kit)

staging が無いため、**migration は本番に直接適用される**。破壊的変更には特に注意が要る。

## migration ごとの適用方針

| migration | 種別 | 破壊性 | 本番適用条件 |
|---|---|---|---|
| 0001-0014 | (初期セットアップ系) | — | 適用済 |
| 0015 | `fixed_shift_submissions` の state trigger | 非破壊 (追加のみ) | 任意 |
| 0016 | `monthly_regular_assignments` テーブル + RLS | 非破壊 (追加のみ) | 任意 |
| 0017 | `regular_shift_periods` マスタ + RLS (α #71) | 非破壊 (追加のみ) | 任意 |
| 0018 | `fixed_shift_submissions.period_id` カラム (β #72) | 非破壊 (追加 NULL 許容) | 任意。後で NOT NULL 化するなら別 migration で |
| 0019 | `monthly_regular_assignments` を DROP、`regular_assignments` を新設 (δ #74) | **破壊的** (テーブル DROP) | **本番にレギュラー確定データがある状態では適用不可**。実験段階なら OK |
| 0020 | `course_confirmations` テーブル + RLS (ε #75) | 非破壊 (追加のみ) | 任意 |
| 0021 | `regular_shift_periods.submission_due_at` CHECK (期内に締切、JST safe、#82 (1)) | **CHECK 追加** (違反データがあれば失敗) | 違反検出 SELECT で 0 行を確認後に適用 |
| 0022 | `course_confirmations` / `regular_assignments` の period 範囲 trigger (#86 (1)) | 非破壊 (BEFORE trigger は既存行を評価しない) | 既存違反行はそのまま残るので清掃推奨 |

## 破壊的 migration の判定基準

以下のいずれかを含む migration は **破壊的**:

- `DROP TABLE` (テーブル削除)
- `DROP COLUMN` (カラム削除)
- `ALTER COLUMN ... TYPE` (型変換、データ損失の可能性)
- `ALTER COLUMN ... NOT NULL` (NULL データがあれば失敗)
- 既存 CHECK / FK の追加 (違反データがあれば失敗)

破壊的 migration を本番に適用する前に必ず:

1. 影響テーブルに削除対象となるデータが残っていないか SELECT で確認
2. 適用前のバックアップ取得 (Supabase ダッシュボードの Backups タブ)
3. アプリ側のコードが旧 schema に依存していないか grep で確認
4. 適用は深夜帯 (利用者がいない時間帯) を推奨

## 旧 schema 整理ポリシー

`monthly_regular_assignments` のように DROP TABLE 済みでも `src/db/schema.ts` に
export が残っていると、誤って `db.select().from(...)` を書くと型エラーなしで実行時に
`relation does not exist` で死ぬ。

- migration で DROP した直後に schema.ts の対応 export を削除する PR を出す
- drizzle-kit snapshot 整合は次の `db:generate` で reconcile される (snapshot から
  自動削除される。手動で snapshot ファイルを編集はしない)
- 過去の Issue: #85, #87

## Vercel 本番 project

| 項目 | 値 |
|---|---|
| Production project | `eisai-manager-5x1o` (旧 `eisai-manager` は 2026-06-12 削除済) |
| Production URL | https://eisai-manager-5x1o.vercel.app |
| Vercel チーム名 | `eisai-manager` (project 名と独立、リネームは別タスク) |
| Production Branch | `main` |
| Preview | PR ごとに自動生成 (新 project のみ、旧 project は削除済) |

### 環境変数 (本番 project)

| Key | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod, Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod, Preview |
| `DATABASE_URL` | Prod, Preview |

### 旧 project 削除の経緯 (2026-06-12)

- 旧 `eisai-manager` (Hobby チーム配下) は HTTP 500 のまま放置されていた (alias は 2026-06-09 時点で 404 化、project 実体は残存)
- 削除前検証: 旧 env ⊂ 新 env、ドメインは `eisai-manager.vercel.app` のみ (カスタムなし)、Git は `hikarucode1/shift-manager` 連携 (削除で自動解除)
- 削除後検証: 新 root=307→/login (200)、旧 root=404、新 project + portfolio 無傷
- PR #81 の旧 Vercel check 表示は GitHub 仕様で履歴に残存 (merged PR は frozen)。新 push 以降は新側のみ

## 関連

- `drizzle.config.ts` — migration 設定
- `drizzle/` — 個別 migration SQL
- `drizzle/meta/` — drizzle snapshot
- `scripts/check-rls-migrations.ts` — 新規 public テーブルに RLS+REVOKE が
  宣言されているかの static check (`npm run check:rls`)
- Issue #85 (2) — 本ドキュメントの起点
