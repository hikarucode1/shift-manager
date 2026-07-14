# レギュラー希望の「誤った月への紐付き」検出・バックフィル (#156)

Issue #156 の修正前は、講師のレギュラー（固定シフト）希望の起点 `effective_from` が
受付中の期の開始日ではなく「提出日の当月」や「古い提出日」に落ちることがあり、
本来と異なる月/期に紐付いた提出が保存されていた可能性がある。

修正後は起点をサーバ側で期の開始日に強制するため新規の誤りは発生しないが、
**修正前に保存された既存データは自動では移行されない**。以下で検出・対処する。

## 1. 検出クエリ（Supabase SQL editor）

期の範囲内 (`start_date <= effective_from <= end_date`) にありながら
**期初 (`start_date`) と一致しない**提出行 = 誤った日/月に紐付いた疑いのある行。

```sql
-- 提出メタ側
SELECT s.tutor_id, pr.display_name, s.effective_from, s.status,
       p.id AS period_id, p.label, p.start_date
FROM fixed_shift_submissions s
JOIN profiles pr ON pr.id = s.tutor_id
JOIN regular_shift_periods p
  ON p.is_archived = false
 AND s.effective_from >= p.start_date
 AND s.effective_from <= p.end_date
WHERE s.effective_from <> p.start_date
ORDER BY p.start_date, pr.display_name;
```

```sql
-- コマ本体側 (fixed_shifts) も同様に確認
SELECT f.tutor_id, pr.display_name, f.effective_from, count(*) AS slots,
       p.id AS period_id, p.label, p.start_date
FROM fixed_shifts f
JOIN profiles pr ON pr.id = f.tutor_id
JOIN regular_shift_periods p
  ON p.is_archived = false
 AND f.effective_from >= p.start_date
 AND f.effective_from <= p.end_date
WHERE f.effective_from <> p.start_date
GROUP BY f.tutor_id, pr.display_name, f.effective_from, p.id, p.label, p.start_date
ORDER BY p.start_date, pr.display_name;
```

> 期に属さない（どの期の範囲にも入らない）アドホック提出は正当なケースなので
> ここでは検出対象外。

## 2. 対処方針

原則、**該当講師に期初で再提出してもらう**のが最も安全（本人の意図を確認できる）。
修正後は起点が期初に固定されるため、再提出すれば `delete-forward` で古い行も掃除される。

件数が多く一括移行する場合のみ、以下を検討（**実行前に必ずバックアップ / 影響確認**）。

```sql
-- 【要バックアップ】誤った行の effective_from を期初へ寄せ直す例。
-- 同一 (tutor, 期初) に既存行があると PK 衝突するため、事前に重複を確認すること。
-- fixed_shifts / fixed_shift_submissions の両方を同一トランザクションで揃える。
-- ここでは雛形のみ示す。実行は移行 Issue で個別に設計する。
```

## 3. 補足

- 修正 PR: #160（`resolveSubmissionEffectiveFrom` による起点の一元化 + サーバ側強制）
- 一括バックフィルを行う場合は別 Issue で PK 衝突・ロールバックまで設計してから実施する。
