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
3. 既存の取り消し済みの行を、それまでの判定式で埋める (下の 3 節と同じ SQL)

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

マージから Vercel の反映までの間に、古いコードが取り消した行は
`close_kind` が空のまま残る (古いコードは列を知らない)。

## 3. 埋め直す (マージの後に 1 回)

0037 の 3 と同じ SQL。空の行だけを埋めるので、何度流しても結果は同じ。

```sql
UPDATE absence_requests SET close_kind = CASE
  WHEN decision_note = '交代成立により自動失効' AND decided_by IS NULL THEN 'auto_expired'::absence_close_kind
  WHEN decision_note = '担当でなくなったため自動失効' AND decided_by IS NULL THEN 'expired_unassigned'::absence_close_kind
  WHEN decision_note = '担当変更のため不要' AND decided_by IS NOT NULL THEN 'unassigned'::absence_close_kind
  WHEN decision_note IS NULL AND decided_by IS NULL THEN 'tutor_withdraw'::absence_close_kind
  ELSE 'admin_cancel'::absence_close_kind
END
WHERE status = 'cancelled' AND close_kind IS NULL;
```

その後、1 節の確認の SQL で 0 件になることを見る。

## 4. 人が確かめる行

それまでの判定式は文言に頼っていたので、次の行は種類を取り違えているおそれが
ある。件数と中身を見て、違っていれば `close_kind` を手で直す。

```sql
SELECT a.id, p.display_name, a.date, a.slot_number,
       a.close_kind, a.decision_note, a.decided_by, a.decided_at
FROM absence_requests a
JOIN profiles p ON p.id = a.tutor_id
WHERE a.status = 'cancelled'
  AND (
    -- PR #290 より前に、教室長が承認済みの取り消し理由へたまたま
    -- 「担当変更のため不要」と書いた → 本当は admin_cancel
    a.close_kind = 'unassigned'
    -- 不要として閉じた教室長のプロフィールが削除され decided_by が null に
    -- なった → 本当は unassigned
    OR (a.close_kind = 'admin_cancel' AND a.decided_by IS NULL)
  )
ORDER BY a.decided_at;
```

`unassigned` の行は、元が未処理 (pending) だったか承認済み (approved) だったかを
行からは区別できない。台帳の取り消しの経緯や、教室長の記憶で確かめる。
PR #290 (`closeUnassignedAbsence`) のマージより前の `decided_at` なら、
`unassigned` ではありえない (その経路がまだ無い) ので `admin_cancel` に直す。

## 5. その後 (別の PR)

全部埋め終わったら、「取り消し済みなら `close_kind` が必ず入っている」制約
(CHECK) を足せる。今回入れないのは、1 と 2 の間に古いコードが取り消しを
書き込むたびに失敗して、本番の取り消しが止まるため。
