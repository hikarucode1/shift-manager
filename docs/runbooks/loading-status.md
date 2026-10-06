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
どちらも Next 16.2.4。**Next を上げたら測り直す** (この節の挙動は Next の実装で決まる)。

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

## 3. 障害の種類ごとの見え方

どの層で失敗するかで、見え方が変わる。認証 API の判定は `src/lib/auth-availability.ts` の `isAuthUnavailable` (auth-js の `handleError`, `node_modules/@supabase/auth-js/dist/main/lib/fetch.js` が作るエラーを見る。**auth-js を上げたら、どの応答がどのエラーになるかを確かめ直す**)。

| 障害 | middleware | 利用者に見えるもの | 実測 |
|---|---|---|---|
| **page だけの失敗**: layout の認可は通り、page のクエリが失敗する (schema の不整合の多く。2026-07-30 の migration 0029 未適用はこれ) | 素通し | **200 + loading のスケルトン**。hydration 後に error.tsx (エラー ID は Next の digest)。**JS が動かないとスケルトンのまま** (#189) | 200 は #192 / #190 で実測 |
| **layout の認可が失敗する DB の障害**: DB の全断・DATABASE_URL の誤り・プール枯渇 | 素通し | layout の `requireRole` が失敗 → `resolveOrIncident` → **200 + SystemUnavailable** (エラー ID は `reportIncident`)。最初の HTML に載るので JS 不要 | #192 で実測 |
| **認証 API に届かない**: fetch の失敗、auth-js が retryable とするステータス、**本文が JSON でない応答 (ステータスは問わない)**、JSON の本文で 500 / 429 (`UNAVAILABLE_STATUS`) | 「ログアウト」とみなさず素通し (#193) | **200 + SystemUnavailable** | 未実測 |
| **認証 API が JSON の本文で、それ以外のステータスを返す** (401 / 403 / 404 / 540 など) | 「ログアウト」と区別できない | **/login へ 307** (`src/components/system-unavailable.tsx` の「到達不能と判定できない残りの形」) | 未実測 |

- ⚠️ **Supabase Free tier の自動 pause が 3 行目と 4 行目のどちらに入るかは分かっていない** (#294)。GoTrue が動いていて自分の DB に届かない形 (JSON の 500) や、ゲートウェイが 540 を JSON でない本文で返す形なら 3 行目 (200 + SystemUnavailable)。ゲートウェイが **540 を JSON の本文で**返す形なら 4 行目 (/login へ 307) で、#193 が直そうとした形が残る
- ⚠️ **3・4 行目の挙動は、セッションの cookie があるリクエストだけ**。cookie が無いと、auth-js は認証 API を呼ばずに「未ログイン」を返すので、middleware は障害に関係なく /login へ 307 し、ログイン画面は正常に出る。**cookie なしで画面を叩く確認では、認証 API の障害は見えない**
- SystemUnavailable の文言「画面を表示できませんでした。」は、error.tsx (page の失敗) と、`/` `/login` `/auth/confirm` `/auth/set-password` でも出る (`grep -rl SystemUnavailable src/app` で確認)。**文言では、どの層の失敗か区別できない**
- **画面を叩いてステータスや文言を見る監視では、障害を区別できない**。200 になる障害は正常と区別できず、307 になる障害もあり、cookie の有無でも変わる。死活は画面ではなく専用のエンドポイントで見る。#275 は今のところ DB の確認 (`select 1` → 503) が対象で、認証 API まで見るかは未定。認証 API の停止は、#275 が DB だけを見る形だと検知できない
- migration の未適用は `.github/workflows/check-migrations.yml` (#204 / #206。main への push と毎日の cron) が見ている

## 4. 配下でステータス (404 / 3xx / 403) が要るときの選択肢

境界の内側 (配下の page と入れ子の layout) では、上の表のとおり 200 になる。次のどれかを選ぶ。

- **ルートグループで境界の外に出す**: `loading.tsx` / `error.tsx` を `admin/(guarded)/` に移し、ステータスが要るルートを `admin/(plain)/` に置く。URL と AdminLayout (ヘッダ・ナビ) は変わらない。個別の項目の 404 (存在しない講師の詳細など) はこれ。ただし:
  - リポジトリに `not-found.tsx` が 1 つも無い。`admin/(plain)/not-found.tsx` を置かないと、Next 既定の 404 がルートの直下に出る
  - (plain) 側には error.tsx と loading.tsx が無いので、DB 障害でページが throw すると**素の 500** に戻る (#186 で直した状態)。ステータスを返すことの裏返しで、承知のうえで選ぶ
- **AdminLayout で `notFound()` / `redirect()`** (`authInterrupts` を有効にすれば `forbidden()` も): 境界の外なので効くはず (layout の `redirect()` が 307 になることは TutorLayout で実測済み)。ただし AdminLayout は子の `[id]` を受け取れないので、**セグメント全体で決まる判断 (認可など) に限る**
- **middleware で返す** (`src/middleware.ts` → `updateSession`): `NextResponse` にステータスを付けて返せるので、`authInterrupts` と関係なく 403 も返せる。ただし middleware は毎リクエスト走るので、DB を引く判定には向かない
- **200 を受け入れる**

`forbidden()` で 403 を返すには `authInterrupts` を有効にする必要がある (2 節)。それまでは、誤って呼ばないよう `eslint.config.mjs` の `no-restricted-imports` で `next/navigation` の `forbidden` / `unauthorized` の import を禁止している (#295)。`authInterrupts` を有効にするときは、このルールも外す。

## 5. ほかのコスト

- **境界の内側のエラー表示は hydration 頼み** (#189)。page だけが失敗すると、最初の HTML はスケルトンで、error.tsx は hydration の後に出る。JS が動かない・hydration に失敗すると、スケルトンが延々と脈動したままになる。`StalledLoadingHint` (10 秒後に CSS で案内を出す) はこのためにある。layout の失敗 (SystemUnavailable) は最初の HTML に載るので JS 不要
- **正常時もページ遷移で一瞬スケルトンが出る** (loading.tsx を置く前は、前の画面が残ったまま切り替わった)

## 6. 判断

loading.tsx は残す (#190 で比べ直した結論)。

loading.tsx が守っているのは、**layout は成功して page だけが失敗する場合** (3 節の 1 行目)。これが無いと、page の throw で HTTP 500 + `__next_error__` になり、ヘッダとナビごと消えて他の画面へ移る手段が無くなる (#186。2026-07-30 の障害はこの形)。DB の全断のように layout の認可が失敗する場合は、loading.tsx ではなく layout の `resolveOrIncident` (#188) が受け持っている。

その代わり、境界の内側で失敗しても 200 を返すこと、404 / 307 が返らないこと、エラー表示が hydration 頼みになること、スケルトンが一瞬出ることは承知のうえ。
