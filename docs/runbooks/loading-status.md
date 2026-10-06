# loading.tsx と HTTP ステータス (#186 / #190)

`src/app/admin/loading.tsx` と `src/app/tutor/loading.tsx` を置いているせいで、
**失敗しても HTTP 200 を返し、配下から 404 / 403 を返せない**。それを承知で
残している理由と、障害のときに何が見えるか、ステータスが要るときの選択肢を
まとめる。

コードのコメントには、実測した事実と結論だけを書いている。変わりやすい分析は
ここに置き、**古くなったらこのファイルを PR で直す** (#276 のレビューで、
コメントに書き込みすぎてずれが積み上がったため)。

## 1. 実測した挙動

Next 16.2.4 の本番ビルド。#192 (2026-09 上旬) と #190 (2026-09-29 に再確認)。

| 構成 | Server Component の throw | `notFound()` | 同じ階層の `redirect()` |
|---|---|---|---|
| error.tsx のみ | HTTP 500 + `__next_error__`。error.tsx は描画されない | 404 | 307 |
| error.tsx + loading.tsx | HTTP 200 + loading の HTML。RSC にエラーチャンクが乗り、hydration 後に error.tsx | 200 + `noindex` | **200** (リダイレクトは hydration 後にクライアントが行う) |

- **セグメント自身の layout** (AdminLayout / TutorLayout) は loading.tsx の境界の外にある
  - layout の throw は loading.tsx でも救えず **500** (#187)。そのため各 layout は `resolveOrIncident` で包み、失敗しても throw せず SystemUnavailable を描画する (#188, `src/lib/shell-guard.ts`)
  - layout の `redirect()` は **307** を返す (#192: admin ロールで `/tutor` を開くと TutorLayout が `/admin` へ 307)。`resolveOrIncident` は `unstable_rethrow` で `redirect()` / `notFound()` を握り潰さない (`shell-guard.test.ts` で固定)
- **入れ子の layout** (例: `admin/periods/layout.tsx`) は境界の**内側**。throw は error.tsx が受け止めて 200 になる

## 2. 実測していない (コードから読んだ) こと

- **`forbidden()` は今は使えない**。`experimental.authInterrupts` が未設定なので、呼ぶと**ただの Error** を throw する (`node_modules/next/dist/client/components/forbidden.js`)
  - page から呼ぶと error.tsx の汎用画面 (障害に見える)
  - **AdminLayout / TutorLayout の権限確認から呼ぶと、`resolveOrIncident` に握り潰されて SystemUnavailable + エラー ID になる**。権限が無いだけの利用者に障害画面が出て、偽のインシデントが記録される
- `authInterrupts` を有効にした場合
  - `forbidden()` は 403 の digest を持ち、`unstable_rethrow` が投げ直す。**AdminLayout から呼べば 403 を返せるはず**
  - **page から呼ぶと境界の内側なので 200 のまま** (`notFound()` と同じ)
- AdminLayout の `notFound()` も、境界の外なので 404 になるはず

## 3. 障害の種類ごとの見え方

判定は `src/lib/auth-availability.ts` の `isAuthUnavailable`。ステータスはコードから読んだもので、実測していない。

| 障害 | middleware | 利用者に見えるもの |
|---|---|---|
| **DB だけの障害** (DATABASE_URL の誤り・プール枯渇・schema 不整合) | 素通し | layout の `requireRole` が失敗 → **200 + SystemUnavailable** |
| **認証 API に届かない** (fetch の失敗、502〜530、500、429、JSON でない応答)。**Supabase Free tier の自動 pause はここ** (GoTrue は自分の DB に届かないと 500 を返す) | 「ログアウト」とみなさず素通し (#193) | **200 + SystemUnavailable** |
| **認証 API が上記以外の否定を返す** (401 / 403 / 404 / 540 など。ゲートウェイ型の停止) | 「ログアウト」と区別できない | **/login へ 307** (`src/components/system-unavailable.tsx` の「到達不能と判定できない残りの形」) |

- SystemUnavailable の文言「画面を表示できませんでした。」は、error.tsx (page の失敗) と `/` `/login` でも出る。**文言では、どの層の失敗か区別できない**
- **画面を叩いてステータスや文言を見る監視では、障害を区別できない**。200 になる障害は正常と区別できず、307 になる障害もある。死活は画面ではなく、DB と認証 API をそれぞれ直接確かめるエンドポイントで見る (#275。まだ無い)
- migration の未適用は `.github/workflows/check-migrations.yml` (#204 / #206。main への push と毎日の cron) が見ている

## 4. 配下でステータス (404 / 403) が要るときの選択肢

loading.tsx の境界の内側 (配下の page と入れ子の layout) からは、ステータスを決められない。

- **ルートグループで境界の外に出す**: `loading.tsx` / `error.tsx` を `admin/(guarded)/` に移し、ステータスが要るルートを `admin/(plain)/` に置く。URL と AdminLayout (ヘッダ・ナビ) は変わらない。個別の項目の 404 (存在しない講師の詳細など) はこれ。ただし:
  - リポジトリに `not-found.tsx` が 1 つも無い。`admin/(plain)/not-found.tsx` を置かないと、Next 既定の 404 がルートの直下に出る
  - (plain) 側には error.tsx と loading.tsx が無いので、DB 障害でページが throw すると**素の 500** に戻る (#186 で直した状態)。ステータスを返すことの裏返しで、承知のうえで選ぶ
- **AdminLayout で `notFound()` / `redirect()`** (`authInterrupts` を有効にすれば `forbidden()` も): 境界の外なので効く。ただし AdminLayout は子の `[id]` を受け取れないので、**セグメント全体で決まる判断 (認可など) に限る**
- **200 を受け入れる**

## 5. ほかのコスト

- **正常時もページ遷移で一瞬スケルトンが出る** (loading.tsx を置く前は、前の画面が残ったまま切り替わった)。これを嫌って loading.tsx を外すと、#186 で直した「URL 直アクセスで DB が落ちているとシェルごと 500」が戻る

## 6. 判断

loading.tsx は残す (#190 で比べ直した結論)。URL 直アクセスで DB が落ちていても、シェルごと 500 にならず error.tsx に落ちることを優先する。失敗しても 200 を返すこと、配下から 404 / 403 を返せないこと、スケルトンが一瞬出ることは承知のうえ。
