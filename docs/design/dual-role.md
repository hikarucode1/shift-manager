# 兼任ロール (admin かつ tutor) の権限境界・運用手順

Issue #146 の意思決定を記録する。技術基盤 (`profiles.roles` 配列化 / contains 判定) は
#111 案A として PR #118 で実装済みであり、本書はその上に載る**仕様・運用ルールの確定**である。

- 決定日: 2026-07-09
- 関連: #146 (本書), #111 (前身・案A実装), #92 (admin 保護ガード), #108 (displayName 運用)
- 関連コード: `src/lib/auth.ts`, `src/lib/profile-active.ts`,
  `src/app/admin/tutors/actions.ts`, `src/app/admin/admins/actions.ts`

---

## 1. 権限境界 — 現行実装を仕様として確定

`isActive` は **profile 単位の単一 boolean であり、role 別ではない**。
この前提から導かれる以下の挙動を、意図した仕様として確定する。

### 不変条件

1. **無効化は全ロールに作用する。**
   兼任者 (`roles = ['admin','tutor']`) をどちらの一覧から無効化しても、
   admin / tutor 両方の資格でログイン不能になる (`requireSession` の
   `!profile.isActive` 分岐)。「講師としてだけ無効化」はできない。
2. **自分自身は変更不可 (self-lockout 防止)。**
   `setAdminActive` / `setTutorActive` の両経路で `id === 操作者` を拒否する。
   兼任者は**自分自身を講師一覧からも無効化できない**。
3. **「最後の有効教室長」保護は経路を問わず適用する。**
   無効化対象が admin role を含む場合、講師一覧経由 (`setTutorActive`) でも
   admin 一覧経由と同一のガードを通す (#92)。ガードは共有ヘルパ
   `setProfileActive` に集約済みで、`admins_active_count` advisory lock により
   2 教室長が同時に互いを無効化する race も防止される。

### 採用しなかった代替案

- **role 別 `isActive` への分割**: 「講師としてだけ無効化」が可能になるが、
  `requireSession` / 一覧クエリ / 招待フローの全面改修を要する。現状の運用規模
  (教室長 1〜2 名) に対して過剰なため不採用。必要になった時点で再検討する。

### UI 上の扱い (重複表示)

兼任者は講師一覧 (`/admin/tutors`) と教室長一覧 (`/admin/admins`) の
**両方に表示する** (仕様)。どちらの画面からも該当ロールの管理操作
(氏名変更・有効/無効) ができるべきであり、片方から隠すと管理不能になるため。

混乱防止のため両一覧に以下を実装する:

- 兼任者の行に「教室長兼任」/「講師兼任」バッジを表示
- 兼任者を無効化する操作の付近に「全ロールでログイン不能になる」旨を明示

なお、兼任者向けの専用 UI (ロール切替トグル等) は #146 でもスコープ外。

---

## 2. 運用手順

### 2-1. 案B (別 email で 2 profile) は不採用で確定

1 人の人物には 1 profile を対応させ、兼任は `roles` 配列 (案A) で表現する。
別 email で admin 用 / tutor 用の 2 profile を持つ運用は、

- シフト・申請データ上のアイデンティティが分裂する
- 招待・無効化を二重管理することになる
- 「最後の有効教室長」ガードの意味が曖昧になる

ため**行わない**。テスト用途でも本番 DB では作らないこと。

### 2-2. 既存 admin を兼任化する runbook

対象例: `hikaruken0126@gmail.com` (admin) に tutor role を追加する。

**事前確認 (必須)**

1. **displayName の一意性**: tutor role を持つ行には部分一意インデックス
   `profiles_tutor_name_uniq` が効く。対象の `display_name` が既存講師と
   重複していないこと。重複する場合は先に #108 の要領で displayName を変更する。
2. **CSV 照合**: 確定シフト CSV の取り込みは講師の `display_name` で照合される。
   兼任者がシフトに入るなら、CSV 上の講師名と `display_name` を一致させておく。
3. **stub 重複の有無**: 過去の CSV 取り込みで同名の stub 講師 profile
   (auth 未連携) が既にある場合、role 追加ではなくその stub との統合方針を
   先に決める (データが割れるため安易に両方残さない)。

**適用 (Supabase SQL editor)**

```sql
-- 冪等: 既に tutor を含む場合は何もしない
UPDATE profiles
SET roles = array_append(roles, 'tutor'),
    updated_at = now()
WHERE email = 'hikaruken0126@gmail.com'
  AND NOT ('tutor' = ANY(roles));
```

**適用後の確認**

```sql
SELECT id, display_name, roles, is_active
FROM profiles
WHERE email = 'hikaruken0126@gmail.com';
```

- `/admin/tutors` と `/admin/admins` の両方に「兼任」バッジ付きで表示されること
- ログイン後のランディングは admin 優先 (`landingPath`) のまま変わらないこと
- 講師側画面 (`/tutor`) にも自分でアクセスできること

**ロールバック**

```sql
UPDATE profiles
SET roles = array_remove(roles, 'tutor'),
    updated_at = now()
WHERE email = 'hikaruken0126@gmail.com';
```

> tutor として確定シフト・申請データが既に紐付いた後の role 除去は、
> 画面から見えなくなるだけでデータは残る。除去前に該当期間のシフト有無を確認する。
