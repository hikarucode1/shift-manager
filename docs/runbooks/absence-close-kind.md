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
3. 既存の取り消し済みの行を、`decision_note` の定型文で埋める。教室長が取り消し理由に
   たまたま定型文を書いた行は、決めた人と時刻で見分けて `admin_cancel` にする (下の 3 節と同じ SQL)

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
  WHEN decision_note = '交代成立により自動失効' AND decided_by IS NOT NULL
    AND abs(extract(epoch FROM updated_at - decided_at)) < 60 THEN 'admin_cancel'::absence_close_kind
  WHEN decision_note = '交代成立により自動失効' THEN 'auto_expired'::absence_close_kind
  WHEN decision_note = '担当でなくなったため自動失効' AND decided_by IS NOT NULL THEN 'admin_cancel'::absence_close_kind
  WHEN decision_note = '担当でなくなったため自動失効' THEN 'expired_unassigned'::absence_close_kind
  WHEN decision_note = '担当変更のため不要' AND decided_at < '2026-10-05T12:12:14Z' THEN 'admin_cancel'::absence_close_kind
  WHEN decision_note = '担当変更のため不要' THEN 'unassigned'::absence_close_kind
  WHEN decision_note IS NULL AND decided_by IS NULL THEN 'tutor_withdraw'::absence_close_kind
  ELSE 'admin_cancel'::absence_close_kind
END
WHERE status = 'cancelled' AND close_kind IS NULL;
```

その後、1 節の確認の SQL で 0 件になることを見る。**0 件にならなければ、
少し待ってもう一度流す。**

**翌日にもう一度、1 節の確認の SQL で 0 件かを見る。** 反映が終わった後も、
古いタブを開いたままの講師などが古いコードで取り消すことがある (Vercel の
skew protection が有効なら、古いコードがしばらく受け付け続ける)。0 件で
なければ、上の SQL をもう一度流す。5 節の制約は、これが 0 件になってから。

## 4. 埋めた結果を確かめる

定型文で分類した行のうち、教室長の取り消しと見分けた行 (上の SQL で
`admin_cancel` にした行) と、見分けが付かない行を並べる。違っていれば
`close_kind` を手で直す。

見分け方 (上の SQL と同じ):

- **「交代成立により自動失効」**: 本当の自動失効は、PR #235 (#225) 以降は
  決めた人を空にし、それより前は決めた人と決めた時刻 (= 承認したとき) に
  触らず更新時刻だけを進めていた。教室長の取り消しは、決めた人・決めた時刻・
  更新時刻を同時に書く。→ 決めた人が入っていて、決めた時刻と更新時刻の差が
  1 分以内なら教室長の取り消し
- **「担当でなくなったため自動失効」** (#291): 本当の失効は最初から決めた人を
  空にしている。→ 決めた人が入っていれば教室長の取り消し
- **「担当変更のため不要」**: 「不要として閉じる」(PR #290) のマージ
  (2026-10-05T12:12:14Z) より前には、その経路が無い。→ それより前に閉じた
  行は教室長の取り消し

```sql
SELECT a.id, p.display_name, a.date, a.slot_number,
       a.close_kind, a.decision_note, a.decided_by, a.decided_at, a.updated_at
FROM absence_requests a
JOIN profiles p ON p.id = a.tutor_id
WHERE a.status = 'cancelled'
  AND (
    -- 定型文なのに教室長の取り消しにした行
    (a.close_kind = 'admin_cancel'
      AND a.decision_note IN ('交代成立により自動失効',
                              '担当でなくなったため自動失効',
                              '担当変更のため不要'))
    -- 教室長の取り消しなのに決めた人が空 → 教室長のプロフィールが削除
    -- された。本当は「不要として閉じる」(unassigned) 行でないか
    OR (a.close_kind = 'admin_cancel' AND a.decided_by IS NULL)
  )
ORDER BY a.decided_at;
```

- 承認から 1 分以内に交代が成立した本当の自動失効は、教室長の取り消しに
  分類される (まれ)。PR #290 のマージ直後の数分 (本番への反映前) に教室長が
  「担当変更のため不要」と書いた取り消しは、「不要として閉じる」に分類される。
  どちらも経緯を確かめてから直す
- 定型文の取り違えは、PR #290 (「担当変更のため不要」) / PR #298 (2 つの
  自動失効の文言) で取り消し理由に書けなくなる前にだけ起こりうる

## 5. その後 (別の PR)

全部埋め終わったら、「取り消し済みなら `close_kind` が必ず入っている」制約
(CHECK) を足せる。今回入れないのは、1 と 2 の間に古いコードが取り消しを
書き込むたびに失敗して、本番の取り消しが止まるため。
