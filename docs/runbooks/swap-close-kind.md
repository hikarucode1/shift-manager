# 交代・代講申請の閉じ方 (`close_kind`) の反映 (#293)

#293 で、交代・代講申請がどう閉じたか (講師の取り下げ・教室長の代理募集の
取り下げ・承認済みの取り消し・担当が変わってシステムが締め切った) を、専用の
列 `swap_requests.close_kind` で記録・判定するようにした。欠勤の #292
(`docs/runbooks/absence-close-kind.md`) と同じ作りで、反映の順番も同じ:
**migration → コードのマージ → 埋め直し**。

列を読むコードが列より先に動くと、交代の画面と台帳がすべて落ちる。

## 0. 前提

0037 (#292) まで適用済みであること。`drizzle.__drizzle_migrations` の最大の
`created_at` が `1791355061735` (0037) になっているかを見る。

## 1. migration 0038 を本番に流す (コードのマージより前)

`drizzle/0038_swap_close_kind.sql` は次の 3 つを行う。

1. 型 `swap_close_kind` を作る
2. `swap_requests.close_kind` (null 可) を足す
3. 既存の取り消し済みの行を埋める (下の 3 節と同じ SQL)

手で流す場合、続けて記録の行を足す (`created_at` は `_journal.json` の 0038 の
`when`、`hash` はファイルの sha256):

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('4578b7bfb6f61c7ab122ef87400de29edb25403f68654595c1773100fa24f502', 1791793528824);
```

適用後の確認 (0 件なら埋め終わっている):

```sql
SELECT count(*) FROM swap_requests
WHERE status = 'cancelled' AND close_kind IS NULL;
```

## 2. コードをマージする

マージから Vercel の反映が終わるまでの間に、古いコードが閉じた行は
`close_kind` が空のまま残る。その間、台帳は空の行を以前の判定 (決めた人の
有無と、代講者が決まっていたか) で分ける。

## 3. 埋め直す (Vercel の反映が終わってから)

**Vercel の Deployments で本番の反映が完了したのを確かめてから流す。**
0038 の 3 と同じ SQL。空の行だけを埋めるので、何度流しても結果は同じ。

```sql
UPDATE swap_requests SET close_kind = CASE
  WHEN approved_applicant_id IS NOT NULL THEN 'admin_cancel'::swap_close_kind
  WHEN created_by IS NOT NULL AND created_by <> requester_id THEN 'admin_withdraw'::swap_close_kind
  WHEN decided_by IS NULL THEN 'tutor_withdraw'::swap_close_kind
  ELSE 'admin_withdraw'::swap_close_kind
END
WHERE status = 'cancelled' AND close_kind IS NULL;
```

その後、1 節の確認の SQL で 0 件になることを見る。**翌日にもう一度** 0 件かを
見る (古いタブなどで古いコードが動くことがある)。

## 4. 埋め方と、取り違えうる形

| 条件 (上から順に) | 種類 | 根拠 |
|---|---|---|
| 代講者が決まっていた (`approved_applicant_id` あり) | `admin_cancel` | 承認済みを閉じられるのは教室長の取り消し (`cancelApprovedSwap`) だけ |
| 教室長の代理募集 (`created_by` が申請者と違う) | `admin_withdraw` | 代理募集は講師が取り下げられない (`cancelSwapRequest` が弾く) |
| 決めた人が空 | `tutor_withdraw` | 講師の取り下げは `decided_by` を書かない |
| それ以外 | `admin_withdraw` | 念のための受け皿。今のコードでは起きない |

- 代講者のプロフィールが削除されて `approved_applicant_id` が空になった取り消し
  は、`admin_withdraw` か `tutor_withdraw` に取り違えうる (今は講師のプロフィールを
  削除しない運用)
- `unassignable` (システムが締め切った) は、このコードより前には無いので埋めない

## 5. その後 (別の PR)

全部埋め終わったら、「取り消し済みなら `close_kind` が必ず入っている」制約
(CHECK) を足せる (欠勤の #292 と同じく、反映の間に古いコードが書く行で取り消しが
止まらないよう、今は入れない)。
