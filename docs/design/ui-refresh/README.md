# Handoff: Shift Manager UI 刷新

## Overview
個別指導塾向けシフト管理アプリ（`hikarucode1/shift-manager`）の UI 刷新案。
教室長（admin）の PC 管理画面 7 画面、講師（tutor）のスマホ画面 5 画面、ログイン 1 画面、
計 13 画面のデザインリファレンス。既存の配色（ネイビー primary / オレンジ accent）と
トップナビ構成を踏襲したまま、各画面のレイアウト・情報設計をブラッシュアップしている。

## About the Design Files
このバンドルに含まれる `ShiftManager.dc.html` は **HTML で作成したデザインリファレンス**であり、
本番コードとしてそのままコピーするものではない。意図した見た目・レイアウト・状態表現を示す
プロトタイプ。タスクは、このデザインを **既存リポジトリの環境（Next.js 16 App Router /
TypeScript / Tailwind CSS v4 / shadcn/ui (new-york) / lucide-react）で再現すること**。
既存の `src/components/ui/*`（shadcn プリミティブ）・`app-shell.tsx`・`globals.css` の
トークンを使い、ファイル構成（`src/app/{admin,tutor}/...`）に合わせて実装する。

> このプロトタイプはインラインスタイルで描かれているが、実装では Tailwind ユーティリティ +
> shadcn コンポーネント（Card / Button / Badge / Table / Tabs / Select / Input など）に
> 置き換えること。色は下記の通り **既存 CSS 変数（`hsl(var(--primary))` 等）** にマッピングする。

## Fidelity
**High-fidelity (hifi)**。最終的な配色・タイポ・余白・状態表現を含む。既存の design token と
shadcn コンポーネントで忠実に再現する。データはダミー（実データは Drizzle 経由のサーバー取得）。

## Design Tokens（既存 globals.css と一致）
プロトタイプの生 hex は、既存の CSS 変数にマッピングして使う。

| 用途 | プロトタイプ hex | 既存トークン (HSL) | Tailwind |
|---|---|---|---|
| primary（ネイビー） | `#1b2a64` | `228 57% 25%` | `bg-primary text-primary-foreground` |
| accent（オレンジ） | `#e9803a` | `24 80% 57%` | `bg-accent text-accent-foreground` |
| foreground | `#0f172a` | `222 84% 4.9%` | `text-foreground` |
| muted bg | `#f1f5f9` | `210 40% 96.1%` | `bg-muted` |
| muted-foreground | `#64748b` / `#94a3b8` | `215 16% 47%` | `text-muted-foreground` |
| border | `#e2e8f0` / `#eef2f6` | `214 32% 91%` | `border` |
| destructive（欠勤・赤） | `#dc2626` / bg `#fdeaea` | `0 72% 51%` | `text-destructive` / `bg-destructive/10` |
| success（連携済・承認済） | text `#15803d` bg `#e7f6ec` | — | `text-green-700 bg-green-50` |
| accent badge bg（代講・希望中） | text `#9a4d12` bg `#fdf0e6` | — | `text-accent` 系 / `bg-accent/10` |

- radius: `--radius: 0.5rem`（カード `rounded-lg`、バッジ `rounded-md/sm`）
- font: 既存の `--font-sans`（system + Yu Gothic / Hiragino）。プロトタイプは Noto Sans JP で代用。
- 曜日色: 平日 `#475569` / 土 `#2563eb`(青) / 日 `#dc2626`(赤)
- shadow: カードは shadcn 既定（`shadow-sm`）。プロトタイプの `0 1px 3px rgba(15,23,42,.1)` 相当。
- コマ定義（globals/seed 準拠）: 1限 09:30–10:55 / 2限 11:00–12:25 / 3限 12:30–13:55 /
  4限 14:00–15:25 / 5限 15:30–16:55 / 6限 17:00–18:25 / 7限 18:30–19:55 / 8限 20:00–21:25

## Layout 共通
- **教室長（PC）**: `AppShell`（既存）= sticky ネイビーヘッダー + 横ナビ + `max-w-6xl` 本文。
  ナビ項目: ダッシュボード / 週次シフト / 講師管理 / 期間管理 / 講習希望 / Excel取り込み / 申請承認。
  アクティブは `bg-primary-foreground/15`。本文は `p-4 sm:p-6`。
- **講師（スマホ）**: 同じ `AppShell`（モバイル幅）。ネイビーヘッダー + 下部タブ
  （ホーム / シフト / 希望提出 / 申請）。プロトタイプの端末枠は実装不要。

## Screens / Views

### 1. ログイン（/login）
- **Purpose**: メール+パスワードでサインイン（Supabase Auth）。
- **Layout**: `bg-muted` 全画面センタリング。`Card` w≈360px、`p-8`、`rounded-xl`、薄い影。
- **Components**: ロゴ（ネイビー角丸 46px・"S"）+ "Shift Manager" + サブ "個別指導塾シフト管理"。
  `Label`+`Input`（メール／パスワード）。primary 全幅ボタン「ログイン」（実装は accent ではなく
  既存 primary でも可。プロトはオレンジ）。下部に「パスワードをお忘れですか？」リンク（muted）。

### 2. 教室長 ダッシュボード（/admin）
- **Purpose**: 当日の状況把握・申請への即応。
- **Layout**: 上段 4 列 KPI グリッド（`grid-cols-4 gap-3.5`）、下段 `grid-cols-[1.4fr_1fr] gap-5`。
- **Components**:
  - KPI カード ×4: 「今週の確定コマ 38」「未承認の申請 3」（左ボーダー accent 3px・数字 accent）
    「講習希望 提出 18 / 24」「未連携の講師 2」。各 `border rounded-lg p-4`、ラベル12px muted、数字28px bold。
  - 左: 「承認待ちの申請」リスト。行 = バッジ（欠勤=destructive / 交代=accent）+ 本文 + 承認(primary)/却下(outline)。
  - 右: 「今週の充足状況」カード。大数字 92%（accent の %）+ 進捗バー（accent, width 92%）+ 明細3行。

### 3. 週次シフト表（/admin/weekly）
- **Purpose**: 確定シフト（CSV取込）の閲覧・印刷。既存 `weekly-grid.tsx` 準拠。
- **Layout**: ツールバー（前週/週ラベル/次週・右に講師select+印刷）→ アップロード情報バー（`bg-muted`）→
  テーブル `grid-cols-[92px_repeat(7,1fr)]`、行 = コマ（1〜8限、時刻サブ）、列 = 月〜日。
- **Components**: セル内は講師チップ。通常=`bg-muted ring-1`、欠勤=`bg-destructive/10` 取り消し線+「欠勤」バッジ、
  代講=accent 系 +「代講」バッジ、座席=`座N` outline バッジ。土＝青/日＝赤ヘッダー。
  情報バー: ファイル名 / 公開者 / 公開日時 / 「出勤 38 件・欠勤 2 件(赤)」。

### 4. 講師管理（/admin/tutors）
- **Purpose**: 講師の招待・連携状態の管理。
- **Layout**: ツールバー（検索 Input + 状態 Select + 右に「＋ 講師を招待」primary）→ Table。
- **Components**: 列 = 氏名（アバター丸+名）/ メール / 状態（連携済=緑 / 未連携=accent バッジ）/
  担当科目 / 操作（「編集」primary テキスト）。`bg-muted` ヘッダー、行ボーダー。

### 5. 期間管理（/admin/periods）
- **Purpose**: 通常期間・講習期間と提出締切の設定。
- **Layout**: `grid-cols-2 gap-5`。左=通常期間、右=講習期間。各列に見出し+「＋追加」outline、カードリスト。
- **Components**: 期間カード `border rounded-lg p-3.5`。状態バッジ（公開中=緑 / 準備中=muted /
  希望受付中=accent）。講習カードは左ボーダー accent。締切は accent 強調。

### 6. 講習希望ヒートマップ（/admin/training）
- **Purpose**: 日 × コマ の希望人数を俯瞰。既存 `training-heatmap.tsx` 準拠。
- **Layout**: ヘッダー（期間名 / 提出 18/24 / 凡例 少→多）→ `grid-cols-[84px_repeat(10,1fr)]` ヒートマップ。
- **Components**: 行 = コマ、列 = 日付。セルは希望人数で 5 段階の濃淡
  （`#f8fafc → #fde8d8 → #f9c89e → #f0a060 → #e9803a`）、数値表示。0 は中点。
  実装では人数→段階の関数を用意（例: 0,1-2,3-4,5-6,7+ など実データに合わせ調整）。

### 7. CSV 取り込みウィザード（/admin/uploads）
- **Purpose**: 確定シフト CSV のアップロード→講師名マッピング確認→確定公開。`upload-wizard.tsx` 準拠。
- **Layout**: ステッパー（① アップロード ✓ → ② マッピング確認(現在) → ③ 確定・公開）→
  ファイル情報バー → マッピング Table → 右下に「戻る」outline /「確定して公開」primary。
- **Components**: ステッパーは完了=primary丸✓、現在=accent丸、未=muted丸。
  マッピング Table 列 = CSV上の講師名 / → / 紐付け先(Select) / 状態（一致=緑 / 推定一致=緑 / 要確認=destructive）。

### 8. 申請承認（/admin/requests）
- **Purpose**: 欠勤・交代申請の承認/却下。`requests-panel.tsx` 準拠。
- **Layout**: Tabs（欠勤申請 [2] / 交代・代講 [1]）→ 申請カードリスト。
- **Components**: 行 = アバター + 本文（誰が・いつ・どのコマ・理由）+ 状態バッジ + 承認(primary)/却下(outline)。
  承認済みは淡色（opacity）+ 緑バッジで履歴表示。

### 9. 講師 ホーム（/tutor）
- **Purpose**: 次の出勤・締切・今週シフトの確認。
- **Layout**: ネイビーヘッダー（名前 + 2 統計: 今週のコマ 9 / 提出締切 あと2日(オレンジ)）→
  本文（締切アラート → 「次の出勤」大カード（ネイビー）→ 今週のシフト一覧）→ 下部タブ。
- **Components**: 締切アラート = `bg-accent/10 border-accent/30`。次の出勤カードはネイビー地・
  大きな「3限 12:30–13:55」+ 座席バッジ(accent) + 生徒名。シフト行 = 日付 + バー + コマ + 状態バッジ
  （確定=緑 / 申請中=accent）。

### 10. 固定シフト登録（/tutor/fixed-shifts）
- **Purpose**: 曜日 × コマ で出勤可否を登録。`fixed-shifts/page.tsx` 準拠。
- **Layout**: ヘッダー（期間名 + 締切）→ `grid-cols-[38px_repeat(6,1fr)]`（月〜土 × 1〜8限）トグルグリッド →
  凡例 → 下部「この内容で提出」primary 全幅。
- **Components**: セルはトグル。出勤可=accent 地「○」、不可=muted ボーダー。タップで切替。

### 11. 講習希望提出（/tutor/training）
- **Purpose**: 講習期間の日別にコマ希望を提出。`tutor/training` 準拠。
- **Layout**: ヘッダー（期間名 + 締切 オレンジ）→ 日付カードの縦リスト → 下部「希望を提出」primary。
- **Components**: 日付カード = 見出し（曜日色）+ 提出状態バッジ（提出済=緑 / 未提出=accent）+
  コマチップ群（1〜8、選択=accent 地 / 未選択=muted）。

### 12. 欠勤申請（/tutor/absences）
- **Purpose**: 確定シフトから対象を選び欠勤を申請。`tutor/absences` 準拠。
- **Layout**: フォーム縦積み: 対象シフト選択 → 理由区分（チップ選択: 体調不良/私用/学業/その他）→
  詳細メモ（textarea）→ 注意バナー → 下部「欠勤を申請」primary。
- **Components**: 選択中チップ=primary 地。注意バナー = `bg-accent/10`（承認必要・代講募集に出せる旨）。

### 13. 代講募集・応募（/tutor/open-swaps）
- **Purpose**: 代講の募集を見て応募。`tutor/open-swaps` 準拠。
- **Layout**: ヘッダー（応募できる募集 N 件）→ 募集カードリスト → 下部タブ。
- **Components**: 募集カード = 日付/コマ + 状態バッジ（募集中=accent）+ 詳細（時刻・誰の代講・科目）+
  「応募する」primary 全幅。応募済みは淡色 + 緑バッジ（承認待ち）。

## Interactions & Behavior
- ナビ/タブ: アクティブ項目をハイライト（PC=ヘッダー横ナビ、スマホ=下部タブ）。
- 週ナビ: 前週/次週で `?week=YYYY-MM-DD` 遷移（既存 `weekly-grid.tsx` の挙動を踏襲）。
- 講師フィルタ Select: 選択講師のみ表示し空コマ行を畳む（既存ロジックあり）。
- 印刷: `window.print()`。週次は A4 横・ヘッダー非表示（既存 `globals.css @media print` 準拠、`.weekly-print`）。
- 承認/却下: Server Action 経由で状態更新 → リスト再描画。確認ダイアログ推奨。
- 固定シフト/講習希望のセル: クリックでトグル、未保存差分を保持し「提出」で確定。
- CSV ウィザード: 3 ステップ。要確認マッピングが残る場合は「確定して公開」を無効化推奨。
- 締切超過時: 提出系フォームは read-only 表示に。

## State Management
- データ取得は既存方針通り **サーバー仲介**（Server Component / Server Action + Drizzle）。
  クライアントは表示状態（タブ選択、フィルタ、トグルの未保存差分、ステッパー位置）のみ保持。
- 既存ライブラリ: react-hook-form + zod（フォーム検証）、date-fns / date-fns-tz（JST 固定）。
- 認可: `requireRole`（admin/tutor）でページガード（既存 `layout.tsx`）。

## Responsive
- PC 画面（admin）は `max-w-6xl` 内で `md` 以上想定。週次/ヒートマップ/Table は横スクロール可（`overflow-x-auto`）。
- 講師画面は単一カラム・モバイルファースト。プロトの端末枠（角丸ボーダー）は装飾で実装不要。

## Assets
- アイコンは **lucide-react**（既存）。プロトの簡易図形（チェック・四角・丸ドット）は
  lucide（Check, FileText, ChevronLeft/Right, Printer, LogOut 等）に置換。
- ロゴは "S" のテキストマーク（既存に正式ロゴがあればそれを使用）。

## Files
- `ShiftManager.dc.html` — 全 13 画面のデザインリファレンス（このバンドルに同梱）。
  ブラウザで開くと全画面がラベル付きで縦に並ぶ（ログイン / 教室長 PC / 講師 スマホ）。
- 参照する既存実装: `src/components/app-shell.tsx`, `src/app/globals.css`,
  `src/app/admin/weekly/weekly-grid.tsx`, `src/app/admin/uploads/upload-wizard.tsx`,
  `src/app/admin/training/training-heatmap.tsx`, `src/app/admin/requests/requests-panel.tsx`,
  `src/components/ui/*`（shadcn プリミティブ）。
