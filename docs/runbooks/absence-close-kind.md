# 欠勤申請の閉じ方 (`close_kind`) の反映 (#292)

#292 で、欠勤申請がどう閉じたか (講師の取り下げ・教室長の取り消し・不要として
閉じる・2 種類の自動失効) を、自由文の `decision_note` ではなく専用の列
`absence_requests.close_kind` で判定するようにした。

列を読むコードが列より先に動くと、欠勤の画面と台帳がすべて落ちる。反映は
**migration → コードのマージ → 埋め直し** の順で行う。

## 1. migration 0037 を本番に流す (コードのマージより前)

`drizzle/0037_absence_close_kind.sql` は次の 3 つを行う。

1. 型 `absence_close_kind` を作る
2. `absence_requests.close_kind` (null 可) を足す
3. 既存の取り消し済みの行を、`decision_note` の定型文で埋める (下の 3 節と同じ SQL)

列を足して埋めるだけなので、今動いているコードは壊れない。適用の方法は
`docs/migration-policy.md` (pooler 経由の `db:migrate` は使えない)。手で流す
場合、`drizzle.__drizzle_migrations` の `created_at` には
`drizzle/meta/_journal.json` の 0037 の `when` (`1791355061735`) を入れる。

⚠️ 適用の前に `__drizzle_migrations` の最大の `created_at` を見て、0036
(`1787717302036`) まで適用済みかを確かめる。`docs/migration-policy.md` には
0036 が「未適用」と書かれたままになっている。

適用後の確認 (0 件なら埋め終わっている):

```sql
SELECT count(*) FROM absence_requests
WHERE status = 'cancelled' AND close_kind IS NULL;
```

## 2. コードをマージする

マージから Vercel の反映が終わるまでの間に、古いコードが取り消した行は
`close_kind` が空のまま残る (古いコードは列を知らない)。その間、台帳は
空の行を、決めた人の有無で「教室長が取り消し」か「講師が取り下げ」に
分ける (自動失効などの種類までは分からない)。

## 3. 埋め直す (Vercel の反映が終わってから)

**マージ直後ではなく、Vercel の Deployments で本番の反映が完了したのを
確かめてから流す。** 反映の途中は、古いコードがまだリクエストを受けている
ことがある。

0037 の 3 と同じ SQL。空の行だけを埋めるので、何度流しても結果は同じ。

```sql
UPDATE absence_requests SET close_kind = CASE
  WHEN decision_note = '交代成立により自動失効' THEN 'auto_expired'::absence_close_kind
  WHEN decision_note = '担当でなくなったため自動失効' THEN 'expired_unassigned'::absence_close_kind
  WHEN decision_note = '担当変更のため不要' THEN 'unassigned'::absence_close_kind
  WHEN decision_note IS NULL AND decided_by IS NULL THEN 'tutor_withdraw'::absence_close_kind
  ELSE 'admin_cancel'::absence_close_kind
END
WHERE status = 'cancelled' AND close_kind IS NULL;
```

その後、1 節の確認の SQL で 0 件になることを見る。**0 件にならなければ、
少し待ってもう一度流す。**

埋める判定は定型文だけで、`decided_by` は見ない。#225 (PR #235) より前の
自動失効は、承認済みの欠勤なら `decided_by` に承認した教室長が残っている
ので、`decided_by` を条件にすると「教室長の取り消し」に化けるため。

## 4. 人が確かめる行

定型文だけで埋めたので、次の 3 つの形は種類を取り違えているおそれがある。
件数と中身を見て、違っていれば `close_kind` を手で直す。

```sql
SELECT a.id, p.display_name, a.date, a.slot_number,
       a.close_kind, a.decision_note, a.decided_by, a.decided_at
FROM absence_requests a
JOIN profiles p ON p.id = a.tutor_id
WHERE a.status = 'cancelled'
  AND (
    -- (a) 「不要として閉じる」(PR #290) がまだ無かった頃に「担当変更のため不要」
    --     で閉じた行 → 教室長が承認済みの取り消し理由にたまたま書いた。
    --     本当は admin_cancel
    (a.close_kind = 'unassigned'
      AND a.decided_at < '2026-10-05T12:12:14Z')
    -- (b) 自動失効が decided_by を空にするようになった (PR #235) 後なのに、
    --     「交代成立により自動失効」で決めた人が入っている行 → 教室長が
    --     取り消し理由にたまたま書いた。本当は admin_cancel
    OR (a.close_kind = 'auto_expired'
      AND a.decided_by IS NOT NULL
      AND a.decided_at >= '2026-08-26T05:29:01Z')
    -- (c) 教室長の取り消しなのに決めた人が空 → 教室長のプロフィールが削除
    --     された。種類は admin_cancel のままでよいが、本当は不要として
    --     閉じた (unassigned) 行でないかを確かめる
    OR (a.close_kind = 'admin_cancel' AND a.decided_by IS NULL)
  )
ORDER BY a.decided_at;
```

- 時刻は PR のマージ時刻 (UTC)。本番への反映は数分遅れるので、境目の
  前後数分の行は、自動失効のこともある。経緯を確かめてから直す
- (a) と (b) の取り違えは、それぞれ PR #290 / PR #298 で取り消し理由に
  定型文を書けなくなる前にだけ起こりうる

## 5. その後 (別の PR)

全部埋め終わったら、「取り消し済みなら `close_kind` が必ず入っている」制約
(CHECK) を足せる。今回入れないのは、1 と 2 の間に古いコードが取り消しを
書き込むたびに失敗して、本番の取り消しが止まるため。
