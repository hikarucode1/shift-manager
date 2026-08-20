---
name: verify
description: shift-manager の変更をローカル (Supabase 未接続環境) で実機検証する手順
---

# shift-manager ローカル検証レシピ

この環境の `.env.local` はプレースホルダーで、実 Supabase / DB 接続は無い
(Docker・supabase CLI も無し)。実機検証は以下のハーネスで行う。

検証したいものによって手法が違う:

| 検証したいもの | 手法 |
|---|---|
| 画面・ナビ・UI の挙動 | DEV_STUB_AUTH で認証をバイパス (下記 A) |
| **認証/セッションそのものの挙動** | **`NEXT_PUBLIC_SUPABASE_URL` を差し替える (下記 B)。アプリのソースを一切書き換えないので、認証コードは本番と同じものが走る** |
| server action の DB 書き込み | ローカルでは不可 → PR に明記し preview 環境で確認 |

---

## A. DEV_STUB_AUTH ハーネス (毎回一時適用 → 検証後に必ず戻す)

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

> ⚠️ **本番ビルドではバイパスが効かない**。`process.env.NODE_ENV` は
> `next build` の時点でバンドルに畳み込まれる (`.next/server` 配下の js に
> `process.env.NODE_ENV` は 1 つも残らない) ため、上の AND 条件が常に false に
> なる。`next start` に `NODE_ENV=development` を渡しても後の祭り
> (`next` は `NODE_ENV` を**強制はせず既定値を入れるだけ**なので値自体は
> 通るが、畳み込み済みのコードには効かない)。実画面検証は `npm run dev`、
> ステータスコードの厳密測定は本番ビルド + プローブ、と使い分ける。

---

## B. 認証障害の再現 (#193 / #195 / #197 で使った。ソースを一切いじらない)

`NEXT_PUBLIC_SUPABASE_URL` を差し替えるだけで、認証 API の障害を**本物の
エラーとして**再現できる。Next の dotenv は既存の `process.env` を上書き
しないので、コマンドラインで渡せば `.env.local` より優先される。

```bash
# 到達不能 (fetch 自体が失敗する)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-placeholder npm run dev -- -p 3456
```

**応答は返るが失敗する**ケース (401 / 400 invalid_credentials / 429 / 500) は
10 行のスタブサーバーで作れる:

```js
import { createServer } from "node:http";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }  // ⚠️ 必須
  res.writeHead(400, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "..." }));
}).listen(8899);
```

> ⚠️ **CORS preflight に 204 を返さないと**、ブラウザからのログイン試行は
> `net::ERR_FAILED` になり「応答は返っている」対照実験にならない。

### 偽セッション cookie の作り方

ログイン済みの状態が要る場合 (cookie が無いと auth-js はネットワークに出ない)。

- **名前**: `sb-<URL の hostname の先頭ラベル>-auth-token`
  (`http://127.0.0.1:9` → `sb-127-auth-token`、`http://localhost:8899` → `sb-localhost-auth-token`)
- **値**: `base64-` + base64url(セッション JSON)

```js
const s = { access_token:"fake", token_type:"bearer", expires_in:3600,
  expires_at: Math.floor(Date.now()/1000)+3000, refresh_token:"r", user:{ id:"..." } };
console.log("base64-" + Buffer.from(JSON.stringify(s)).toString("base64url"));
```

> ⚠️ **使い回すと `expires_at` が切れる**。切れていると `_refreshAccessToken` の
> 指数バックオフ (`200ms * 2^n`、上限 30 秒) に入り、1 リクエストで 40 秒級
> 待たされる。測る前に作り直す。

**破損の再現**は上のレシピの cookie 1 本でできる: 値の `base64-` より後ろに
不正な文字を混ぜれば同じ経路 (`cookies.js` の base64url デコード) で throw する。

> ⚠️ 上のレシピが作る cookie は 200 文字弱で、`@supabase/ssr` の
> `MAX_CHUNK_SIZE = 3180` に届かないので **`.0` / `.1` には割れない**。
> チャンク自体を再現したいならセッション JSON にダミーを詰めて 3180 文字を
> 超えさせること。

なお chunk の**欠損** (`.1` が消えて `.0` だけ残る) は throw せず
`AuthSessionMissingError` になる (`combineChunks` が falsy chunk で break する)。
このとき auth-js が `TypeError: Cannot create property 'user' on string ...` を
**console.error に吐く**が、これは破損ではなく欠損の正常系。

---

## 駆動 (Playwright)

- scratchpad に `npm i playwright` + `npx playwright install chromium chromium-headless-shell`。
  ビューポートは 390×844 (講師 UI はスマホファースト)
- ⚠️ **必ず `http://localhost:PORT` で開く**。`127.0.0.1` だと Next の
  dev origin allowlist (`localhost` と `allowedDevOrigins` のみ) に外れ、
  **HMR の WebSocket ハンドシェイクが弾かれて hydration が完了しない**
  (`/_next/static/*` 自体は 200 で届く。Origin ヘッダを送るのが WS だけなので、
  script タグは通る)。結果フォームは素の HTML として native submit され、
  「クリックしても何も起きない」形で現れて気づきにくい。
  curl でのステータス測定は `127.0.0.1` でも問題ない
- ページエラー時の dev overlay (`nextjs-portal`) がクリックを遮るため、
  クリック前に `document.querySelectorAll("nextjs-portal").forEach(e => e.remove())`
- ⚠️ **cookie の削除は必ずブラウザの cookie jar で確認する** (`context.cookies()`)。
  `Set-Cookie` ヘッダを読むだけでは不十分: 属性が落ちて「空文字のセッション
  cookie」になっていても Set-Cookie 自体は出るので、消えたように見えて残る
  (#196 で実際に取りこぼした)
- 対照実験で `page.goto` を使うとフルロードで MutationObserver が消えるため、
  クライアント遷移の観測は必ずリンククリックで行う
- server action はスタブ環境では DB 到達時に reject する。これを利用して
  楽観的更新のロールバック/エラー通知パスを観測できる

---

## プロセスの止め方

> ⚠️ **`pkill -f` は自分のコマンド行にもマッチして shell ごと落ちる** (exit 144)。
> ポートから pid を引くこと:

```bash
PID=$(ss -ltnp | grep ':3456' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); kill $PID
```

---

## 後片付け (コミット前に必須)

```bash
git checkout -- src/lib/auth.ts src/lib/supabase/middleware.ts  # A を使った場合
rm -r src/app/tutor/verify-*  # 一時ページ/error.tsx
rm -rf .next/dev              # 消した一時ページの型キャッシュで tsc が落ちるため
```

B の手法はソースを触らないので後片付けは不要 (env はコマンドラインのみ)。

## 通常チェック

`npx tsc --noEmit` / `npm run lint` / `npm test` (vitest) / `npm run check:rls`
