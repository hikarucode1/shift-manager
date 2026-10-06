# loading.tsx と HTTP ステータス (#186 / #190)

`src/app/admin/loading.tsx` と `src/app/tutor/loading.tsx` が作る境界の内側では、
**失敗しても HTTP 200 を返し、`notFound()` の 404 や `redirect()` の 307 も
返らない**。それを承知で残している理由と、障害のときに何が見えるか、
ステータスが要るときの選択肢をまとめる。

コードのコメントには、実測した事実と結論だけを書いている。変わりやすい分析は
ここに置き、**古くなったらこのファイルを PR で直す** (#276 のレビューで、
コメントに書き込みすぎてずれが積み上がったため)。
**実測したことと、コードから読んだだけのことを分けて書く。**

## 1. 実測した挙動

出典: PR #192 (2026-08-12〜13) の実測と、#190 での再確認 (2026-09-29、本番ビルド)。
どちらも Next 16.2.4。

| 境界の内側で起きたこと | loading.tsx が無い | loading.tsx がある |
|---|---|---|
| Server Component の throw | HTTP 500 + `__next_error__`。error.tsx は描画されない | HTTP 200 + loading の HTML。RSC にエラーチャンクが乗り、hydration 後に error.tsx |
| `notFound()` | 404 | 200 + `noindex` |
| `redirect()` | 307 | 200 |

- **セグメント自身の layout** (AdminLayout / TutorLayout) は、そのセグメントの loading.tsx の境界の**外**にある
  - layout の throw は loading.tsx でも救えず **500** (#187)。そのため各 layout は `resolveOrIncident` で包み、失敗しても throw せず SystemUnavailable を描画する (#188, `src/lib/shell-guard.ts`)。#192 の実測: DB 全断を再現すると、修正前は `/tutor` `/admin` とも 500、修正後は 200 + SystemUnavailable
  - layout の `redirect()` は **307** を返す。#192 で実測したのは TutorLayout (admin ロールで `/tutor` を開くと 307 → `/admin`)。AdminLayout も同じ作り (`resolveOrIncident` の中の `requireRole`) なので同じはずだが、実測はしていない。`resolveOrIncident` は `unstable_rethrow` で `redirect()` / `notFound()` を握り潰さない (`src/lib/shell-guard.test.ts` で固定)
- **入れ子の layout** はセグメントの境界の**内側**。#192 の実験 (親に error.tsx + loading.tsx、子の layout が throw) では 200 で、親の境界が描画された。今のリポジトリに入れ子の layout は無い (layout.tsx は `src/app/`、`src/app/admin/`、`src/app/tutor/` の 3 つだけ)

## 2. 実測していない (コードから読んだ) こと

- **境界の内側の `redirect()` (200) の中身**: #192 は「クライアント任せ」と記録したが、Next は HTML に `<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=...">` を入れる (`node_modules/next/dist/server/app-render/make-get-server-inserted-html.js`)。**JS が無くても約 1 秒後にリダイレクトされる**はず (308 のときは 0 秒)
- **`forbidden()` は今は使えない**。`experimental.authInterrupts` が未設定なので (`next.config.ts`)、呼ぶと**ただの Error** を throw する (`node_modules/next/dist/client/components/forbidden.js`)。**loading.tsx の有無とは関係ない**
  - page から呼ぶと error.tsx の汎用画面 (障害に見える)
  - **AdminLayout / TutorLayout の権限確認から呼ぶと、`resolveOrIncident` に握り潰されて SystemUnavailable + エラー ID になる**。権限が無いだけの利用者に障害画面が出て、偽のインシデントが記録される
- `authInterrupts` を有効にした場合
  - `forbidden()` は 403 の digest を持ち、`unstable_rethrow` が投げ直す。**AdminLayout から呼べば 403 を返せるはず**
  - **page から呼ぶと境界の内側なので 200 のまま** (`notFound()` と同じ)
- AdminLayout の `notFound()` も、境界の外なので 404 になるはず

## 3. 障害の種類ごとの見え方 (コードから読んだ。ステータスは未実測)

判定は `src/lib/auth-availability.ts` の `isAuthUnavailable`。

| 障害 | middleware | 利用者に見えるもの |
|---|---|---|
| **DB だけの障害** (DATABASE_URL の誤り・プール枯渇・schema 不整合) | 素通し | layout の `requireRole` が失敗 → **200 + SystemUnavailable** (#192 で実測した形) |
| **認証 API に届かない**: fetch の失敗、auth-js の `NETWORK_ERROR_CODES` (`[502,503,504,520,521,522,523,524,530]`)、**本文が JSON でない応答 (ステータスは問わない)**、JSON の本文で `UNAVAILABLE_STATUS` (500 / 429) | 「ログアウト」とみなさず素通し (#193) | **200 + SystemUnavailable** |
| **認証 API が JSON の本文で、それ以外のステータスを返す** (401 / 403 / 404 / 540 / 505 など) | 「ログアウト」と区別できない | **/login へ 307** (`src/components/system-unavailable.tsx` の「到達不能と判定できない残りの形」) |

判定の順は auth-js の `handleError` (`node_modules/@supabase/auth-js/dist/main/lib/fetch.js`): fetch の失敗 → `NETWORK_ERROR_CODES` → 本文を JSON として読めるか → JSON ならステータスで `AuthApiError`。**同じステータスでも、本文の形式で行が変わる。**

- ⚠️ **Supabase Free tier の自動 pause がどちらの行に入るかは分かっていない** (#294)。GoTrue が動いていて自分の DB に届かない形 (JSON の 500) や、ゲートウェイが 540 を JSON でない本文で返す形なら 2 行目 (200 + SystemUnavailable)。ゲートウェイが **540 を JSON の本文で**返す形なら 3 行目 (/login へ 307) で、#193 が直そうとした形が残る
- SystemUnavailable の文言「画面を表示できませんでした。」は、error.tsx (page の失敗) と `/` `/login` でも出る。**文言では、どの層の失敗か区別できない**
- **画面を叩いてステータスや文言を見る監視では、障害を区別できない**。200 になる障害は正常と区別できず、307 になる障害もある。死活は画面ではなく専用のエンドポイントで見る。#275 は今のところ DB の確認 (`select 1` → 503) が対象で、認証 API まで見るかは未定。認証 API の停止 (3 行目) は、#275 が DB だけを見る形だと検知できない
- migration の未適用は `.github/workflows/check-migrations.yml` (#204 / #206。main への push と毎日の cron) が見ている

## 4. 配下でステータス (404 / 3xx / 403) が要るときの選択肢

境界の内側 (配下の page と入れ子の layout) では、上の表のとおり 200 になる。次のどれかを選ぶ。

- **ルートグループで境界の外に出す**: `loading.tsx` / `error.tsx` を `admin/(guarded)/` に移し、ステータスが要るルートを `admin/(plain)/` に置く。URL と AdminLayout (ヘッダ・ナビ) は変わらない。個別の項目の 404 (存在しない講師の詳細など) はこれ。ただし:
  - リポジトリに `not-found.tsx` が 1 つも無い。`admin/(plain)/not-found.tsx` を置かないと、Next 既定の 404 がルートの直下に出る
  - (plain) 側には error.tsx と loading.tsx が無いので、DB 障害でページが throw すると**素の 500** に戻る (#186 で直した状態)。ステータスを返すことの裏返しで、承知のうえで選ぶ
- **AdminLayout で `notFound()` / `redirect()`** (`authInterrupts` を有効にすれば `forbidden()` も): 境界の外なので効くはず (layout の `redirect()` が 307 になることは TutorLayout で実測済み)。ただし AdminLayout は子の `[id]` を受け取れないので、**セグメント全体で決まる判断 (認可など) に限る**
- **middleware で返す** (`src/middleware.ts` → `updateSession`): `NextResponse` にステータスを付けて返せるので、`authInterrupts` と関係なく 403 も返せる。ただし middleware は毎リクエスト走るので、DB を引く判定には向かない
- **200 を受け入れる**

`forbidden()` で 403 を返すには `authInterrupts` を有効にする必要がある (2 節)。今は誤って呼ばないよう #295 で仕組みを検討している。

## 5. ほかのコスト

- **正常時もページ遷移で一瞬スケルトンが出る** (loading.tsx を置く前は、前の画面が残ったまま切り替わった)。これを嫌って loading.tsx を外すと、#186 で直した「URL 直アクセスで DB が落ちているとシェルごと 500」が戻る

## 6. 判断

loading.tsx は残す (#190 で比べ直した結論)。URL 直アクセスで DB が落ちていても、シェルごと 500 にならず error.tsx に落ちることを優先する。境界の内側で失敗しても 200 を返すこと、404 / 307 が返らないこと、スケルトンが一瞬出ることは承知のうえ。
