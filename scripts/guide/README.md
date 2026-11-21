# 「アプリの使い方」の画像を撮り直す

アプリ内の操作マニュアル「アプリの使い方」(`/tutor/guide`・`/admin/guide`) に載せる画面の画像は、
`scripts/guide/shots.cjs` が撮る。画面を変えたら、手で撮らずにこのスクリプトを流し直す。

- 文章: `src/lib/guide/tutor.ts` (講師用) / `src/lib/guide/admin.ts` (教室長用)
- 画像: `public/guide/{tutor,admin}/*.webp`
- 画像の大きさ: `src/lib/guide/shots.json` (スクリプトが書く。手で直さない)

## 気をつけること

- **手元の DB 専用。** 最初に講師・シフト・申請などのテーブルを空にして、見本のデータを入れ直す。
  `DATABASE_URL` が localhost / 127.0.0.1 でなければ、何もせずに止まる。
- **`public/` はログインなしで見える。** 見本の登場人物 (山田 太郎 さんなど、スクリプトの `CAST`)
  以外のデータを写さない。本番の画面を手で撮って足さない。
- **教室の電話番号は見本の番号に書き換えて撮る。** `src/lib/school.ts` の番号は本物なので、`snap()` が
  撮る直前に画面の電話番号を `DUMMY_PHONE` に置き換える。電話番号の書き方を変えたら、ここも合わせる。
- **撮っている間は `src/` を編集しない。** dev サーバーが作り直して画面を読み込み直し、途中で止まる。
  止まったときは dev サーバーを止め、`.next/dev` を消して起動し直す。

## 用意するもの

1. **手元の Postgres** にマイグレーションを流した DB。
2. **認証を外した dev サーバー。** `.claude/skills/verify/SKILL.md` の「A. DEV_STUB_AUTH ハーネス」のとおり、
   `src/lib/supabase/middleware.ts` と `src/lib/auth.ts` に一時的なバイパスを入れる (コミットしない)。
   撮影では人を切り替えるので、`requireSession()` のバイパスは cookie `stub_role` を見て
   `CAST` の `auth` (auth_user_id) を選ぶ形にする。

   | `stub_role` | だれ | `auth_user_id` |
   |---|---|---|
   | `admin` | 教室長 | `00000000-0000-0000-0000-0000000000a1` |
   | `tutor` (既定) | 山田 太郎 | `00000000-0000-0000-0000-0000000000b1` |
   | `tutor2` | 高橋 美咲 | `7d0f6a3e-1b2c-4d5e-8f90-a1b2c3d4e5f2` |
   | `tutor3` | 伊藤 健太 | `7d0f6a3e-1b2c-4d5e-8f90-a1b2c3d4e5f3` |

   起動するときの環境変数:

   ```bash
   DEV_STUB_AUTH=1 \
   DATABASE_URL=postgres://postgres@127.0.0.1:5433/app \
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8899 \
   NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-placeholder \
   SUPABASE_SERVICE_ROLE_KEY=service-placeholder \
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<撮影用に作った使い捨ての公開鍵> \
   CRON_SECRET=local \
   TZ=Asia/Tokyo \
   npm run dev -- -p 3456
   ```

   - `NEXT_PUBLIC_SUPABASE_URL` の 8899 は、スクリプトが立てる「認証 API の代わり」。講師管理の
     「連携済 / 招待中」を出すのに使う。立っていなくても撮れるが、全員が「状態不明」になる。
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` が無いと、「スマホ通知」の箱そのものが出ない (撮影が止まる)。
     `npx web-push generate-vapid-keys` で作った公開鍵でよい (本番の鍵は使わない)。
3. **Playwright・sharp・iconv-lite・postgres。** `require` で読めること (この環境には入っている)。

## 流し方

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5433/app node scripts/guide/shots.cjs
```

全部で 10 分ほど。段階 (`PHASES`) は上から順に前の段階の続きを操作するので、基本は全部を通して流す。
一部だけ撮り直すときは、段階の名前を並べる (前の段階が済んだ DB の状態で流すこと)。

```bash
node scripts/guide/shots.cjs seed upload      # 見本のデータを入れ直して、座席表の取り込みまで
node scripts/guide/shots.cjs adminScreens     # 教室長の管理画面だけ
```

途中で止まったときは、止まった画面が OS の一時フォルダに `guide-failed-<だれ>.png` で残り、
画面の文字が標準エラーに出る。

## 画像を足す・直す

1. `shots.cjs` の該当する段階で、その画面まで操作して `snap(page, "admin/名前", { clip, marks })` を呼ぶ。
   - `clip`: 撮る範囲 (locator か、その配列)。省くと画面全体
   - `marks`: オレンジの枠で囲むところ (押すボタンなど)。`numbered: true` で 1, 2, 3… の番号が付く
   - `badgeLeft`: 番号がほかの枠の番号と重なるときに、番号を左上に出す枠 (0 始まりの並び順)
2. スクリプトを流す。`shots.json` に名前が入り、`shot("admin/名前", "画像の説明")` と書けるようになる。
   名前を間違えると型エラーになる。
3. `npm test -- guide` で、使っていない画像・ファイルの無い画像が無いことを確かめる。

教室長の画面は幅 1024px (登録済みシフトだけ 1280px)、講師の画面は幅 390px で、どちらも 2 倍の密度で撮る。
