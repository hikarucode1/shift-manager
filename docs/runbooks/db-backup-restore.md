# 本番 DB のバックアップと戻し方

Supabase の無料プランには、画面から戻せるバックアップが無い。そこで
GitHub Actions (`.github/workflows/backup.yml`) が **毎朝 05:00 (JST)** に本番を
丸ごと書き出し、暗号化して **90 日分** 残す。

- 中身: `public` と `drizzle` スキーマ (アプリのデータ・権限・RLS・migration の記録) と、
  `auth.users` / `auth.identities` のデータ (ログインアカウント)
- 形式: `backup-YYYYMMDD-HHMM.sql.gz.gpg` (SQL を gzip で圧縮し、AES256 で暗号化)
- 置き場所: Actions の実行結果の Artifacts
- 作り方: `scripts/backup-db.sh`

⚠️ リポジトリは公開なので、Artifacts は GitHub にログインした誰でもダウンロードできる。
中身は暗号化してあり、パスフレーズが無いと読めない。**パスフレーズは長いランダムな
文字列にして、絶対にどこにも貼らない。**

## 1. 最初の設定 (1 回だけ)

1. パスワード管理アプリなどで、**32 文字以上のランダムな文字列**を作る
2. それを **パスワード管理アプリに保存する** (GitHub の secret は後から読み出せない。
   無くすとバックアップを開けない)
3. GitHub のリポジトリ → Settings → Secrets and variables → Actions →
   New repository secret で、名前 `BACKUP_PASSPHRASE`、値に 1 の文字列を登録
4. Actions → **db backup** → Run workflow で手動で 1 回動かし、緑になって
   Artifacts に `backup-…` が 1 つできることを確かめる

本番 DB への接続は、migration guard と同じ secret `PROD_DATABASE_URL`
(Transaction pooler 6543) を使い、workflow の中でポートだけ 5432 の
**Session pooler** に変えている。

## 2. 毎日の確認

基本は見なくてよい。失敗すると Actions の実行が赤になり、GitHub から通知メールが届く
(既定の通知設定の場合)。たまに Actions → db backup を開いて、緑が続いているかを見る。

⚠️ 公開リポジトリでは、**60 日間コミットが無いと GitHub が定期実行を自動で止める**。
止まると GitHub からメールが来るので、そのときは Actions → db backup → Enable workflow
で戻す。

## 3. 戻し方

**本番を上書きしない。** まず別の場所に戻して中身を確かめる。

### 3-1. ファイルを取ってくる

1. Actions → **db backup** → 戻したい日の実行を開く
2. 下の Artifacts から `backup-…` をダウンロードして zip を展開する
   (`backup-YYYYMMDD-HHMM.sql.gz.gpg` が出てくる)

### 3-2. 手元で中身を見る (一部の行だけ戻したいとき)

Mac なら `brew install gnupg libpq` で `gpg` と `psql` が入る。

```bash
# パスフレーズを聞かれるので、1 で保存したものを入れる
gpg --decrypt backup-YYYYMMDD-HHMM.sql.gz.gpg | gunzip > backup.sql
```

`backup.sql` はふつうの SQL。必要な行を探して、Supabase の SQL Editor で
本番に足し戻す。**平文の `backup.sql` は使い終わったら必ず消す。**

### 3-3. 丸ごと戻す (本番の DB が使えなくなったとき)

1. Supabase で**新しいプロジェクト**を作る (無料プランは 2 つまで)
2. 新しいプロジェクトの Connect → **Session pooler** の URI を控える
3. 流し込む:

   ```bash
   gpg --decrypt backup-YYYYMMDD-HHMM.sql.gz.gpg | gunzip \
     | psql "<2 の URI>" -v ON_ERROR_STOP=1
   ```

   ファイルの最後で、Supabase が新しいテーブルに自動で付ける anon / authenticated の
   権限を外し直し、`auth.users` の削除フックを作り直す。手で追加の SQL を流す必要は無い。
4. 新しいプロジェクトの Authentication 設定を本番と同じにする
   - 「Allow new users to sign up」を**オフ**
   - Site URL / Redirect URLs を本番のアドレスに
   - メールの文面 (`docs/supabase/email-templates/`)
5. Vercel の接続先を新しいプロジェクトに付け替える (Supabase 連携を入れ直す) → 再デプロイ
6. 確かめる: `/api/health` が `{"ok":true}`、室長と講師でログインできる、シフトが見える

パスワードは `auth.users` ごと戻るのでそのまま使える。ただしログイン中の状態は
切れるので、全員もう一度ログインが必要になる。

## まだ試していないこと

- 本物の Supabase プロジェクトへの丸ごと戻し (3-3) はまだ通しで試していない。
  手元の PostgreSQL では、件数・RLS・権限・削除フックまで元どおりになることを
  確かめた (2026-11-18)。ローンチ後に、空の Supabase プロジェクトで一度リハーサルする。
