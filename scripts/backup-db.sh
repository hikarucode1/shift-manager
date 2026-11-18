#!/usr/bin/env bash
# 本番 DB のバックアップを 1 つの暗号化ファイルに書き出す。
# GitHub Actions (.github/workflows/backup.yml) から呼ぶ。手で動かしてもよい。
#
#   BACKUP_DATABASE_URL  pg_dump で読める接続先 (Supabase なら Session pooler 5432)
#   BACKUP_PASSPHRASE    暗号化のパスフレーズ (戻すときに要る。光さんが保管)
#   BACKUP_OUT           出力ファイル (例: backup-20261118.sql.gz.gpg)
#   BACKUP_SKIP_AUTH=1   auth スキーマを含めない (ローカルの試験用。本番では付けない)
#
# 中身 (平文に戻すと 1 本の SQL):
#   1. public と drizzle スキーマの定義・データ・権限 (アプリのデータと migration の記録)
#   2. auth.users / auth.identities のデータだけ
#      (profiles.auth_user_id が指す先。auth の定義は Supabase が持つので含めない)
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL が未設定です}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE が未設定です}"
: "${BACKUP_OUT:?BACKUP_OUT が未設定です}"

# 平文はディスクに置かない (パイプで圧縮・暗号化まで流す)
{
  # 権限 (RLS の REVOKE など) も戻したいので --no-privileges は付けない。
  # 戻し先 (Supabase) には public が最初からあるので、CREATE SCHEMA は
  # IF NOT EXISTS にして、そこで止まらないようにする
  pg_dump "$BACKUP_DATABASE_URL" \
    --schema=public --schema=drizzle \
    --no-owner --quote-all-identifiers \
    | sed -E 's/^CREATE SCHEMA "(public|drizzle)";$/CREATE SCHEMA IF NOT EXISTS "\1";/'
  if [ "${BACKUP_SKIP_AUTH:-}" != "1" ]; then
    pg_dump "$BACKUP_DATABASE_URL" \
      --data-only --table=auth.users --table=auth.identities \
      --no-owner --no-privileges --quote-all-identifiers
  fi
  # 戻したあとに必ず要る後始末も同じファイルに入れておく (手順の漏れを防ぐ)
  # - Supabase では新しく作ったテーブルに anon / authenticated へ自動で権限が付く。
  #   migration で外していた権限を外し直す (RLS はダンプに含まれ、有効のまま戻る)
  # - auth.users の削除フック (drizzle/0009) は auth スキーマ側にあるので
  #   ダンプに入らない。無ければ作り直す
  cat <<'SQL'
DO $restore$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
  END IF;
  IF to_regclass('auth.users') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_deleted' AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER on_auth_user_deleted
      AFTER DELETE ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deleted();
  END IF;
END
$restore$;
SQL
} | gzip -9 | gpg --batch --yes --symmetric --cipher-algo AES256 \
  --pinentry-mode loopback --passphrase-fd 3 \
  --output "$BACKUP_OUT" 3<<<"$BACKUP_PASSPHRASE"

# 空や壊れたファイルを「取れた」扱いにしない: 復号して、各 pg_dump の終わりの印まで読めるか見る
expected=2
[ "${BACKUP_SKIP_AUTH:-}" = "1" ] && expected=1
complete=$(gpg --batch --quiet --decrypt --pinentry-mode loopback --passphrase-fd 3 \
  "$BACKUP_OUT" 3<<<"$BACKUP_PASSPHRASE" | gunzip | grep -c "PostgreSQL database dump complete" || true)
if [ "$complete" -ne "$expected" ]; then
  echo "::error::バックアップの中身が不完全です (${complete}/${expected})"
  exit 1
fi

echo "backup ok: $BACKUP_OUT ($(du -h "$BACKUP_OUT" | cut -f1))"
