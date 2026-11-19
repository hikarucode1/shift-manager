# 出勤前の通知 (pg_cron) の設定

メモ15。講師がマイページで選んだ「最初のコマの○時間前」に、ベルとスマホへ
「今日は 17:00 から出勤です」を送る。送るのは `/api/cron/shift-reminders` で、
**Supabase の pg_cron が 5 分ごとに呼ぶ**。

- アプリ自体は cron を持たない。Vercel Cron は無料プランだと 1 日 1 回しか
  動かせず、GitHub Actions の schedule は 10〜30 分遅れたり飛ばされたりする
  ため、DB 側の pg_cron を使う (11/19 本人判断)
- 「○時間前〜開始時刻」の間ならいつ呼ばれても送る。同じ講師・同じ日は
  notifications の dedupKey (日付) で 1 回だけ。呼ばれ損ねても次の回で届く
- route は `CRON_SECRET` (Vercel の環境変数) と `Authorization: Bearer ...` が
  一致しないと何もしない。未設定なら 503

## 初回の設定 (1 回だけ)

0056 の migration を当てて PR をマージしたあとに行う。

### 1. Supabase の SQL Editor で実行

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 合言葉を DB の中で作って Vault にしまう (外に出さずに作れる)
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'shift_reminder_cron_secret',
  'CRON_SECRET for /api/cron/shift-reminders'
);

-- 5 分ごとにアプリを呼ぶ
select cron.schedule(
  'shift-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://eisai-manager-5x1o.vercel.app/api/cron/shift-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'shift_reminder_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- 2. で Vercel に貼る値
select decrypted_secret from vault.decrypted_secrets
where name = 'shift_reminder_cron_secret';
```

### 2. Vercel に合言葉を入れる

Vercel → プロジェクト → Settings → Environment Variables に
`CRON_SECRET` = 上の最後の SELECT で出た値 (Production のみ) を追加し、
Deployments から最新の本番を Redeploy する (環境変数は再デプロイで反映)。

## 動いているかの確認

```sql
-- 呼び出しの記録 (status_code 200 で {"ok":true,...} なら OK)
select created, status_code, content
from net._http_response order by created desc limit 5;

-- cron 自体の実行記録
select start_time, status, return_message
from cron.job_run_details order by start_time desc limit 5;
```

- 503 `not configured` → Vercel に `CRON_SECRET` が無い、または再デプロイ前
- 401 → Vercel の `CRON_SECRET` と Vault の値が違う

## 止める・戻す

```sql
select cron.unschedule('shift-reminders');
```

合言葉を作り直すときは `vault.update_secret` で更新し、Vercel 側も同じ値に
して再デプロイする。
