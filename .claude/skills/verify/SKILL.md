---
name: verify
description: shift-manager の変更をローカル (Supabase 未接続環境) で実機検証する手順
---

# shift-manager ローカル検証レシピ

この環境の `.env.local` はプレースホルダーで、実 Supabase / DB 接続は無い
(Docker・supabase CLI も無し)。実機検証は以下のハーネスで行う。

## ハーネス構築 (毎回一時適用 → 検証後に必ず戻す)

1. **認証バイパス** (`DEV_STUB_AUTH=1` ガード付き、コミット禁止):
   - バイパス条件には必ず `NODE_ENV !== "production"` を AND で含める。万一
     このパッチをコミットしてしまっても、本番では env 変数だけでは有効化
     できない形にしておく (「コミット禁止」運用だけに頼らない多重防御)。
   - `src/lib/supabase/middleware.ts`: `supabaseResponse` 作成直後に
     `if (process.env.DEV_STUB_AUTH === "1" && process.env.NODE_ENV !== "production") return supabaseResponse;`
   - `src/lib/auth.ts` `requireSession()`: 冒頭で上と同じ条件のとき
     stub profile (`roles: ["tutor"]` など) を返す
2. **ページが DB を叩く場合**: 対象コンポーネントをモックデータで描画する
   一時ページ `src/app/tutor/verify-<issue>/page.tsx` を作る
   (コマ定義は `DEFAULT_SLOTS` を流用)。または一時 `error.tsx` を置けば
   シェル/ナビの検証はページ本体がエラーでも可能
3. 起動: `DEV_STUB_AUTH=1 npm run dev -- -p 3456` (バックグラウンド)

## 駆動

- Playwright (scratchpad に `npm i playwright` + `npx playwright install
  chromium chromium-headless-shell`)。ビューポートは 390×844 (講師 UI は
  スマホファースト)
- ページエラー時の dev overlay (`nextjs-portal`) がクリックを遮るため、
  クリック前に `document.querySelectorAll("nextjs-portal").forEach(e => e.remove())`
- server action はスタブ環境では DB 到達時に reject する。これを利用して
  楽観的更新のロールバック/エラー通知パスを観測できる (成功パスの DB
  書き込みはローカルでは検証不可 → PR に明記し preview 環境で確認)

## 後片付け (コミット前に必須)

```bash
git checkout -- src/lib/auth.ts src/lib/supabase/middleware.ts
rm -r src/app/tutor/verify-*  # 一時ページ/error.tsx
rm -rf .next/dev              # 消した一時ページの型キャッシュで tsc が落ちるため
```

## 通常チェック

`npx tsc --noEmit` / `npm run lint` / `npm test` (vitest)
