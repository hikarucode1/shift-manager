# Migration ポリシー

drizzle migration をどのタイミングで本番 (Supabase) に流すか、どの migration が破壊的かを記録する。

## 環境構成

- 本番 (production): `.env.local` の `DATABASE_URL` が指す Supabase Postgres
- staging / preview: 無し。本番が唯一の DB
- 適用コマンド: `npm run db:migrate` (drizzle-kit) — **ただし下記「⚠️ pooler 経由 migrate の落とし穴」必読**

staging が無いため、**migration は本番に直接適用される**。破壊的変更には特に注意が要る。

### ⚠️ pooler 経由 migrate の落とし穴 (2026-06-23 判明)

`.env.local` の `DATABASE_URL` は Supabase の **transaction pooler (ポート 6543)** を指している。
`npm run db:migrate` (drizzle-kit) は **transaction pooler 経由では正常に動作しない**:

- `CREATE SCHEMA drizzle` / `__drizzle_migrations` の NOTICE を出した後、エラーメッセージを
  握り潰したまま **exit 1** する (適用対象がゼロでも失敗する)
- 一部 migration の DDL だけが auto-commit され、`__drizzle_migrations` の tracking 行は
  書かれない **half-applied** 状態に陥る (2026-06-23 に 0021-0026 でこれが発生)

**対処 (いずれか)**:

1. **migration 専用に direct connection を使う** — Supabase の
   Project Settings > Database > Connection string の **"Direct connection"**
   (`db.<ref>.supabase.co:5432`) を使う。**#165 以降は `drizzle.config.ts` が
   `DIRECT_URL` を優先**するため、`.env.local` に `DIRECT_URL` を設定すれば
   `DATABASE_URL` を差し替えずに `npm run db:migrate` を実行できる
   (`DIRECT_URL` 未設定時は従来どおり `DATABASE_URL`)。
   アプリ実行時は 6543 (transaction pooler) のままでよい。

   > ⚠️ **Session pooler (5432) は direct connection ではない** (2026-07-30 判明)。
   > `aws-N-<region>.pooler.supabase.com:5432` は **Supavisor 経由**であり、
   > **ポート番号が 5432 でも drizzle-kit は同じ握り潰し exit 1 で失敗する**
   > (通常の SQL クエリは問題なく通るので「接続できる = migrate できる」ではない)。
   > 真の direct connection は `db.<ref>.supabase.co:5432` だが、**Free tier では
   > IPv6 専用**のため IPv4 のみの環境からは到達できない。その場合は下記 2 を使う。

2. **direct SQL + tracking reconcile** (direct connection が使えない時の手動適用):
   - 各 migration の `.sql` を statement-breakpoint で分割し postgres-js で直接実行
   - `drizzle.__drizzle_migrations` に `hash` と `created_at` の行を挿入して reconcile

   **⚠️ `created_at` には必ず `drizzle/meta/_journal.json` の当該 entry の `when`
   (= drizzle 内部の `folderMillis`) をそのまま入れる。適用時刻を入れてはいけない。**

   drizzle の適用判定は `created_at` **だけ**を見る (`drizzle-orm/pg-core/dialect.cjs:59-69`):

   ```js
   // テーブル内の「最大 created_at の 1 行だけ」を取り、folderMillis と比較する
   select id, hash, created_at from ... order by created_at desc limit 1
   if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) { /* 適用 */ }
   // 記録時も created_at には folderMillis がそのまま入る
   insert into ... ("hash","created_at") values(${migration.hash}, ${migration.folderMillis})
   ```

   したがって適用時刻や独自の連番を入れると **未適用 migration が恒久的にスキップされる**:
   0033 と 0034 が未適用の状態で 0033 だけ手動適用して `created_at = 適用時刻 (8/5)` を
   入れると、`max(created_at)=8/5` > 0034 の `when`(8/1) となり、以後
   `drizzle-kit migrate` は **0034 を「適用対象なし」と言って永久に飛ばす**。
   逆に journal の `when` より小さい値を入れると、**適用済みの migration を再適用**しようと
   して `CREATE TYPE` 重複等で失敗する。

   - `hash` は記録されるだけで **drizzle は照合しない** (load-bearing ではない)。ただし
     既存の記録済み行と `sha256(fs.readFileSync(file,'utf8'))` (raw file 全文) が一致するか
     を確認しておくと、journal と本番のズレを早期に検知できる衛生として有効

### 本番適用状況 (2026-07-30 確認・0032 まで適用済) ← 最新

> 以降の節は履歴。現在の到達点はこの節 (**0032 まで適用済、recorded=33**)。
>
> **0033 (#176) は 2026-08-25 に適用済 (recorded=34)。**
>
> **0034 (#217) は未適用。** 非破壊なので適用前検証は不要だが、
> **コード deploy より先に適用**すること (上表 0034 の行を参照)。

**⚠️ 「任意」と書かれた migration は自動では流れない** — 2026-07-30 の監査で、本番が
**0028 までしか適用されていない**ことが判明した (recorded=29)。`notifications` テーブルと
`notification_type` enum が存在せず、**#155 の通知機能 (#164/#166/#180) は本番で
一切動いていなかった**。migration を「任意」に分類しても、その機能のコードを deploy した
時点で適用が必須になる。**機能 PR をマージしたら対応 migration の適用状況を必ず確認する**
(`npm run check:migrations` で機械的に検出できる)。

**2026-08-20: この確認を自動化した (#204)** — `.github/workflows/check-migrations.yml` が
main への push 時と毎朝 06:00 JST に `check:migrations` を回す。人手の運用ルールに
頼らないための多重防御。**secret `PROD_DATABASE_URL` が未設定だと workflow は落ちる**
(skip にすると「監視しているつもりで何も見ていない」状態が静かに続き、防ぎたい事故と
同じ形になるため)。値は **ダッシュボード上部の緑の Connect ボタン** > Transaction pooler
(6543) の URI (⚠️ Settings 配下ではない。2026-08 時点の UI では左ナビに Database の項目は
無く、下の 0026 の手順にある "Project Settings > Database" は旧 UI の記述)。
`DATABASE_URL` と別名なのは、他のジョブが誤って本番へ繋がないようにするため。

**なぜ 9 日間気づけなかったか (症状の非対称性)** — 0029 生成 (7/21) から発覚 (7/30) まで
テーブル不在に気づけなかったのは、経路によって症状が違ったため:

| 経路 | テーブル未作成時の挙動 |
|---|---|
| ベルの未読バッジ (`notification-bell.tsx`) | `.catch(() => {})` で握り潰し → **バッジは 0 のまま無症状** (#168 で意図的にそう設計) |
| `/tutor/notifications` (`page.tsx`) | `getNotifications` を素で await → **開くとエラー画面** |

つまり **「ベルは静かに壊れ、一覧を開くと落ちる」**。次回は「バッジがずっと 0 のまま」を
migration 未適用のサインとして疑う。

適用手順の記録 (2026-07-30): Session pooler 経由の `npm run db:migrate` は上記のとおり
exit 1 で失敗 (ただし**トランザクションが丸ごとロールバックされ half-applied には
ならなかった**)。direct connection は IPv6 専用で到達不可だったため、**上記 2 の
direct SQL + tracking reconcile** で 0029-0032 を **1 トランザクションで適用**した。
適用前検証: 0031 の CHECK 違反 0 件 / 期範囲外 `training_preferences` 0 件。
適用後検証: 全オブジェクト存在確認 + **CHECK/trigger/unique が実際に強制されることを
ロールバック付き tx で実挙動確認** (23514 / 23514 / 23505)。

**⚠️ 初回 reconcile 時に `created_at` を「既存 max + 1 の連番」で入れてしまい、後から
journal の `when` (folderMillis) に是正した** (2026-07-30 中に修正済み)。連番のままだと
`max(created_at)` が 0029-0032 の `when` より小さいため、将来 direct connection から
`drizzle-kit migrate` を実行した際に **適用済みの 0029-0032 を再適用しようとして
`CREATE TYPE` 重複で失敗**するところだった。現在は
`max(created_at) = 1785223359887` (= 0032 の `when`) で、再適用対象なしを確認済み。

**⚠️ 本番アプリの DB 接続状態 (2026-07-30 時点)**: 適用作業時に Supabase の DB パスワードを
リセットしたため、**Vercel 本番の `DATABASE_URL` は古いパスワードのままで DB 接続不可**。
env 更新 + 再デプロイが必要 (未実施)。また Supabase は **Free tier のため非アクティブで
自動 pause** される (paused 中は DB 不通 = 本番アプリも実質ダウン。ダッシュボードの
Resume project で復帰、データは保持される)。

### 本番適用状況 (2026-06-23 確認)

read-only クエリで `drizzle.__drizzle_migrations` を確認したところ、本番は長らく **0020 まで**
(最終適用 2026-05-31) で止まっており、**0021-0026 の 6 本が未適用**だった。上記 half-applied を
経て、direct SQL + tracking reconcile で **0026 まで全適用・検証済み** (recorded=27、
CHECK / trigger / NOT NULL すべてオブジェクト単位で存在確認)。対象テーブルはほぼ空
(regular_shift_periods=1 行、regular_assignments / course_confirmations=0 行) でリスク無し。

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
| 0021 | `regular_shift_periods.submission_due_at` CHECK (期内に締切、JST safe、#82 (1)) | **CHECK 追加** (違反データがあれば失敗) | 違反検出 SELECT で 0 行を確認後に適用 (2026-06-23 適用済) |
| 0022 | `course_confirmations` / `regular_assignments` の period 範囲 trigger (#86 (1)) | 非破壊 (BEFORE trigger は既存行を評価しない) | 既存違反行はそのまま残るので清掃推奨 (2026-06-23 適用済) |
| 0023 | 0015 / 0022 trigger 関数の hardening (`SET search_path`、dead-code 明示、#98/#99) | 非破壊 (CREATE OR REPLACE FUNCTION) | 任意 (2026-06-23 適用済) |
| 0024 | `regular_assignments.effective_to` を backfill 後 NOT NULL 化 (#87) | **破壊的** (ALTER NOT NULL、NULL 行があれば失敗。LOCK + backfill 同梱) | `effective_to IS NULL` 件数を確認後に適用 (2026-06-23 適用済、0 行) |
| 0025 | NOT NULL 化後の range trigger 関数から NULL 分岐を除去 (#87 follow-up) | 非破壊 (CREATE OR REPLACE FUNCTION) | 0024 適用後に適用 (2026-06-23 適用済) |
| 0026 | 親 period 更新時に child 範囲外を検出する BEFORE UPDATE trigger (#97) | 非破壊 (trigger 追加) | 任意 (2026-06-23 適用済) |
| 0027 | `periods.kind` 撤廃 (#110)。**⚠️ コメントの安全前提が誤り** | **破壊的** (DELETE + DROP COLUMN) | 適用済。下記注記参照 |
| 0028 | `profiles.role` → `roles` 配列化 (#111) | 非破壊 (追加 + backfill) | 適用済 |
| 0029 | `notifications` テーブル + RLS (#155) | 非破壊 (追加のみ) | **2026-07-30 適用済**。通知機能 (#164/#166/#180) の動作に必須 (任意ではない) |
| 0030 | `notifications.dedup_key` + unique index (#155) | 非破壊 (追加のみ) | **2026-07-30 適用済** |
| 0031 | `fixed_shift_submissions` の effective_to>=effective_from CHECK + `training_preferences` 日付範囲 trigger + 0010 関数の search_path hardening (#165) | **CHECK 追加** (違反行があれば失敗) + trigger/関数追加 | CHECK は `effective_to < effective_from` の行が 0 件であることを確認後に適用。trigger/関数は非破壊。**2026-07-30 適用済** (違反 0 件確認のうえ) |
| 0032 | `notification_type` enum に `swap_posted` 追加 (#155 後続) | 非破壊 (`ALTER TYPE ADD VALUE`) | **コード deploy より先に適用**。値追加自体は既存行に影響なしだが、`swap_posted` を使うコードが migration より前に稼働すると notify insert が invalid-enum で失敗する (fire-and-forget で握り潰され通知がロストするだけで致命ではないが、deploy⇔migrate の順序に注意)。**⚠️ tx 境界**: `drizzle-kit migrate` は未適用 migration を 1 トランザクションでまとめて流すため、PG は「同一 tx 内で追加した enum 値の *使用*」を拒否する。将来 `swap_posted` を DML/DEFAULT で使う migration を作る場合、0032 と同じ未適用バッチに入ると `unsafe use of new value` でバッチ全体が失敗する。0032 は `ALTER TYPE ADD VALUE` 単独で main は 0031 まで適用済みのため今回は問題なし。enum 値を使う migration は必ず 0032 適用後の別バッチにすること。**2026-07-30 適用済** |
| 0033 | 親 period 更新時に範囲外 `training_preferences` を検出する BEFORE UPDATE trigger (#176)。0026 (`course_confirmations` / `regular_assignments`) の子テーブル違いのクローン | 非破壊 (BEFORE trigger は既存行を評価しないため**適用自体は必ず通る**) | **適用前に下記「0033 適用前の検証」の SELECT で 0 件を確認すること**。違反行を残したまま適用すると、その期は以後 `updatePeriod` で日付を変更できなくなる。しかも**エラー文言は「先に該当分を削除してください」と言うのに、UI から削除する手段が無い** — 講師画面 (`src/lib/training.ts`) も admin ヒートマップ (`src/lib/training-overview.ts`) も `eachDate(p.startDate, p.endDate)` で日を組み立てるため範囲外の希望は**表示されず**、唯一の削除経路 `applyTrainingSlots` (`src/app/tutor/training/actions.ts`) も on/off を区別する**前**に範囲外日付を弾くため **OFF (DELETE) も拒否される**。逃げ道は「その行を覆う方向に期を広げる」か direct SQL のみ |
| 0034 | `absence_requests.created_by` 追加 (#217) | 非破壊 (nullable 列 + FK 追加のみ) | **コード deploy より先に適用（必須）**。教室長の代理登録 (`createAbsenceOnBehalf`) と 講師本人の申請の insert がこの列に書くため、列が無い状態でコードが動くと insert が 落ちて欠勤を登録できない。既存行は null のままでよい。**0032 より深刻**で、0032 の未適用は通知ロストで済むのに対し、0034 の未適用は講師の申請と教室長の代理登録の**両方**が insert 失敗して欠勤機能が全停止する |

### 0033 適用前の検証 (必須)

0033 は BEFORE trigger なので**既存の違反行があっても適用は成功する**。危険なのは適用後で、
違反行が残っている期は日付変更が恒久的にブロックされ、かつ**アプリ側にその行を消す経路が無い**
(上表 0033 の行を参照)。したがって適用前に下記が **0 件**であることを必ず確認する:

```sql
SELECT tp.period_id, tp.date, p.start_date, p.end_date, count(*) OVER () AS total
FROM training_preferences tp
JOIN periods p ON p.id = tp.period_id
WHERE tp.date < p.start_date OR tp.date > p.end_date;
```

0 件でなければ**先に direct SQL で清掃してから**適用する (アプリ経由では消せない)。

> 2026-07-30 の 0029-0032 適用時は「期範囲外 `training_preferences` 0 件」を確認済み。
> ただし**親側 (期を縮める操作) の穴は 0033 まで塞がっていなかった**ため、
> 7/30 以降に期を縮めていれば新たに発生している可能性がある。**再確認は省略しないこと。**

**マージ⇔適用の順序**: `.github/workflows/check-migrations.yml` (#204) は `push: main` と
毎朝 06:00 JST に走る。0033 を main にマージした時点で journal=0033 / 本番=0032 となり、
**本番へ適用するまで migration guard は赤のまま**になる (それが期待動作)。
PR の CI が green なのはこの workflow が `pull_request` では動かないためで、
「CI green = 適用済み」ではない。


### ⚠️ 0027 の安全前提の誤り (#165 監査で判明)

0027 のコメントは「`normal` 行が子を持つ場合は FK (onDelete restrict) で失敗する」と
記載しているが、**実際には `periods` の子 3 テーブル (`course_confirmations` /
`training_preferences` / `training_period_notes`) はいずれも `onDelete: cascade`**
(`src/db/schema.ts`)。したがって `DELETE FROM periods` は失敗せず **黙って子行を連鎖削除**する。
0027 適用時は本番の `normal` 行が子 0 件だったため実害は無かったが、前提は誤り。

**今後 `periods` を物理削除するコード/migration を書く場合は、FK restrict による
保護は無い**ことを前提に、明示的に子の存在確認・扱いを決めること。現行アプリは
`periods` を物理削除せず `is_archived` の論理削除のみ (`setPeriodArchived`) なので
ライブの経路は無い。

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
- `scripts/check-migrations.ts` — journal と本番の `drizzle.__drizzle_migrations` を
  比較して**未適用 migration を列挙**する read-only チェック
  (`DATABASE_URL='...' npm run check:migrations`)。migrate と違い通常のクエリなので
  **pooler 経由でも動く**。機能 PR のマージ後・deploy 前に実行する
- Issue #85 (2) — 本ドキュメントの起点
