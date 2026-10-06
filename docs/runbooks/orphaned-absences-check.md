# 担当でなくなったコマに残っている欠勤の検出 (#291)

PR #298 以降、代講を取り消すと、代講者がそのコマ (まだ終わっていないもの) に
出していた欠勤申請は自動失効する (`ABSENCE_EXPIRED_UNASSIGNED_NOTE`)。

**それより前に取り消された代講では、この失効が行われていない。** 代講者の
欠勤が未処理 (pending) か承認済み (approved) のまま残っていると、その講師が
あとでそのコマの担当に戻ったとき、週次表に欠勤マークが付き、新しい欠勤も
一意制約 (`absence_requests_active_uniq`) で出せない。

自動で書き換える migration は置いていない (本当に休む欠勤まで消すおそれが
あるため)。以下で件数と中身を見て、1 件ずつ判断する。

## 1. 検出クエリ (Supabase SQL editor)

これから先のコマ (日本時間で今日以降) にある、未処理・承認済みの欠勤のうち、
**その講師がそのコマの担当ではない**もの。

```sql
SELECT a.id,
       p.display_name,
       a.date,
       a.slot_number,
       a.status,
       a.decision_note,
       a.created_at
FROM absence_requests a
JOIN profiles p ON p.id = a.tutor_id
WHERE a.status IN ('pending', 'approved')
  AND a.date >= (now() AT TIME ZONE 'Asia/Tokyo')::date
  AND NOT EXISTS (
    SELECT 1
    FROM weekly_shifts w
    WHERE w.tutor_id = a.tutor_id
      AND w.date = a.date
      AND w.slot_number = a.slot_number
  )
ORDER BY a.date, a.slot_number;
```

ここに出る行は、代講の取り消しで残ったものだけではない。CSV の取り込みで
担当が変わった場合も出る (教室長が休む講師のコマを差し替えた場合など。
その欠勤は本当に休むので、残すのが正しいことが多い)。

## 2. 対処

- **未処理 (pending)**: 「未対応」タブの欠勤カードに「このコマは今は担当では
  ありません…」と出る (#289 / PR #290)。そこから「不要として閉じる」か
  承認する
- **承認済み (approved)**: 画面から自動失効の扱いにする手段は無い。経緯を
  確かめ、代講の取り消しで残ったもの (= 講師は実際にはそのコマに関係しない)
  なら、「記録」タブから取り消す (`cancelApprovedAbsence`)。理由欄には自由に
  経緯を書く (システムの印の文言は使えない)

終わったコマの欠勤は対象にしない。実際に休んだ記録として残す (PR #298)。
