"use strict";
/**
 * 「アプリの使い方」(src/lib/guide) に載せる画面の画像を撮り直すスクリプト。
 *
 * 画面を変えたら、このスクリプトを流して画像を撮り直す (手で撮らない)。
 * 見本のデータを入れ直し、実際の画面を順に操作しながら撮るので、
 * 「欠勤を申請 → 教室長が承認 → 代講の依頼が届く」のような流れの途中の
 * 画面も、毎回同じ形で撮れる。
 *
 * ⚠️ **手元の DB 専用。** 最初に講師・シフト・申請などのテーブルを空にする。
 * 接続先が localhost / 127.0.0.1 でなければ何もせず止まる。
 *
 * 用意するもの (詳しくは scripts/guide/README.md):
 *  1. 手元の Postgres にマイグレーションを流した DB (`DATABASE_URL`)
 *  2. 認証を外した dev サーバー (verify スキルの A。cookie `stub_role` で
 *     人を切り替える) を `GUIDE_BASE_URL` (既定 http://localhost:3456) で起動
 *  3. Playwright (この環境には入っている)
 *
 * 使い方:
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/app node scripts/guide/shots.cjs
 *   … 一部だけ流す: node scripts/guide/shots.cjs seed upload
 *
 * 撮った画像は public/guide/ に WebP で、大きさは src/lib/guide/shots.json に入る。
 * ⚠️ public/ はログインなしで見えるので、見本のデータ以外を写さないこと。
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const postgres = require("postgres");
const sharp = require("sharp");
const iconv = require("iconv-lite");

const ROOT = path.resolve(__dirname, "../..");
const BASE = process.env.GUIDE_BASE_URL ?? "http://localhost:3456";
const DB_URL = process.env.DATABASE_URL ?? "";
const OUT_DIR = path.join(ROOT, "public/guide");
const MANIFEST = path.join(ROOT, "src/lib/guide/shots.json");
/** 画面を開いてから操作できるようになるまで待つ時間 (dev サーバーの hydration) */
const SETTLE_MS = Number(process.env.GUIDE_SETTLE_MS ?? 2500);

// ───────────────────────── 見本の登場人物 ─────────────────────────
// cookie `stub_role` の値 → auth_user_id は、認証スタブの対応と合わせること
const CAST = {
  admin: {
    id: "a1a1a1a1-0000-4000-8000-0000000000a1",
    auth: "00000000-0000-0000-0000-0000000000a1",
    name: "教室長",
    email: "kyoshitsucho@example.com",
    roles: ["admin"],
  },
  tutor: {
    id: "b1b1b1b1-0000-4000-8000-0000000000b1",
    auth: "00000000-0000-0000-0000-0000000000b1",
    name: "山田 太郎",
    email: "yamada@example.com",
    track: "science",
    subjects: ["jh_en", "jh_math", "jh_sci", "hs_math1a", "hs_math2bc", "hs_phys_basic"],
  },
  tutor2: {
    id: "5b1e2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c02",
    auth: "7d0f6a3e-1b2c-4d5e-8f90-a1b2c3d4e5f2",
    name: "高橋 美咲",
    email: "takahashi@example.com",
    track: "humanities",
    subjects: ["jh_en", "jh_ja", "jh_soc", "hs_en", "hs_gendai", "hs_kobun"],
  },
  tutor3: {
    id: "5b1e2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c03",
    auth: "7d0f6a3e-1b2c-4d5e-8f90-a1b2c3d4e5f3",
    name: "伊藤 健太",
    email: "ito@example.com",
    track: "both",
    subjects: ["jh_en", "jh_math", "hs_en", "hs_math1a"],
  },
  sato: {
    id: "b2b2b2b2-0000-4000-8000-0000000000b2",
    auth: "00000000-0000-0000-0000-0000000000b2",
    name: "佐藤 花子",
    email: "sato@example.com",
    track: "humanities",
    subjects: ["jh_en", "jh_ja", "hs_en", "hs_jhist"],
  },
  suzuki: {
    id: "b3b3b3b3-0000-4000-8000-0000000000b3",
    auth: "00000000-0000-0000-0000-0000000000b3",
    name: "鈴木 一郎",
    email: "suzuki@example.com",
    track: "science",
    subjects: ["jh_math", "jh_sci", "hs_chem_basic", "hs_chem"],
  },
  tanaka: {
    id: "b4b4b4b4-0000-4000-8000-0000000000b4",
    auth: "00000000-0000-0000-0000-0000000000b4",
    name: "田中 さくら",
    email: "tanaka@example.com",
    // 担当科目をまだ登録していない人
    track: null,
    subjects: [],
  },
  nakamura: {
    id: "b5b5b5b5-0000-4000-8000-0000000000b5",
    // まだ招待していない (ログイン未連携) 人
    auth: null,
    name: "中村 葵",
    email: "stub-b5b5b5b5-0000-4000-8000-0000000000b5@example.invalid",
    track: null,
    subjects: [],
  },
};

// ───────────────────────── 認証 API の代わり ─────────────────────────
/**
 * 講師管理の「連携済 / 招待中」は認証 API (auth.users) から読む。手元には無いので、
 * 一覧だけ返す小さなサーバーを立てる (dev サーバーの NEXT_PUBLIC_SUPABASE_URL を
 * ここへ向けておく)。立っていなくても撮れるが、全員が「状態不明」になる。
 */
const AUTH_STUB_PORT = Number(process.env.GUIDE_AUTH_STUB_PORT ?? 8899);
function startAuthStub() {
  const users = Object.values(CAST)
    .filter((p) => p.auth)
    .map((p) => ({
      id: p.auth,
      email: p.email,
      // 田中さんだけ「招待中」(招待メールのリンクをまだ開いていない)
      email_confirmed_at: p === CAST.tanaka ? null : "2026-01-01T00:00:00Z",
    }));
  const server = require("node:http").createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && url.pathname === "/auth/v1/admin/users") {
      const page = Number(url.searchParams.get("page") ?? 1);
      res.end(JSON.stringify({ users: page === 1 ? users : [], aud: "authenticated" }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ code: 404, msg: "not found (guide stub)" }));
  });
  return new Promise((resolve) => {
    server.once("error", () => {
      console.warn(`認証 API の代わりを :${AUTH_STUB_PORT} に立てられませんでした (講師管理は「状態不明」で撮ります)`);
      resolve(null);
    });
    server.listen(AUTH_STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ───────────────────────── 日付 (JST) ─────────────────────────
const DAY = 86400000;
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
/** JST の今日を UTC の 0 時として持つ (getUTC* で読む) */
function jstToday() {
  const now = new Date(Date.now() + 9 * 3600000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function addDays(d, n) {
  return new Date(d.getTime() + n * DAY);
}
function iso(d) {
  return d.toISOString().slice(0, 10);
}
/** その日を含む週の月曜 */
function mondayOf(d) {
  return addDays(d, -((d.getUTCDay() + 6) % 7));
}
const TODAY = jstToday();
/** 今週・来週・再来週の月曜 */
const WEEK_A = mondayOf(TODAY);
const WEEK_B = addDays(WEEK_A, 7);
const WEEK_C = addDays(WEEK_A, 14);
/** 週の月曜と曜日 (0=月) から日付 */
const dayOf = (monday, weekday) => addDays(monday, weekday);
/** 画面の「12/3（木）」の形 */
function label(d) {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[(d.getUTCDay() + 6) % 7]}）`;
}

// ───────────────────────── 見本の座席表 ─────────────────────────
const SLOT_TIME = {
  1: "13:10〜14:40",
  2: "14:50〜16:20",
  3: "16:30〜18:00",
  4: "18:10〜19:40",
  5: "19:50〜21:20",
};
const Y = CAST.tutor.name;
const T = CAST.tutor2.name;
const I = CAST.tutor3.name;
const S = CAST.sato.name;
const Z = CAST.suzuki.name;
const N = CAST.tanaka.name;
const GROUP = "全体研修";

/**
 * 1 週間分。曜日 (0=月) ごとに { 何限: [行, ...] }。null は休みの日。
 * 行は [講師, 生徒, 生徒]。生徒が無い行は「未定」、生徒が「研修」なら研修。
 */
const WEEK_SPECS = {
  // 今週
  A: [
    null,
    { 3: [[T, "小川結衣(国)"], [S, "森陽向(英)", "池田芽依(国)"]], 4: [[Y, "木村颯太(数)"], [I, "加藤美羽(英)"]] },
    { 3: [[Z, "清水大和(理)"]], 4: [[N, "林悠真(数)"], [T, "山口凛(英)"]] },
    { 4: [[S, "森陽向(国)"]], 5: [[Y, "青木陽菜(英)", "井上蓮(数)"], [I, "加藤美羽(数)"]] },
    { 3: [[N, "林悠真(英)"]], 4: [[Z, "清水大和(数)"]] },
    { 2: [[T, "山口凛(数)"]], 3: [[Y, "木村颯太(英)"], [S, "池田芽依(英)"]] },
    null,
  ],
  // 来週: 山田さんに 授業・未定・研修・体験・全体研修 が全部ある
  B: [
    null,
    { 3: [[T, "小川結衣(国)"], [S, "森陽向(英)"]], 4: [[Y, "木村颯太(数)"], [I, "加藤美羽(英)"], [N]] },
    { 3: [[Y], [Z, "清水大和(理)"]], 4: [[I, "林悠真(数)"], [T, "山口凛(英)"]] },
    { 4: [[T, "青木陽菜(国)"], [S, "森陽向(国)"]], 5: [[Y, "研修"], [I, "加藤美羽(数)"]] },
    { 3: [[Y, "【体験】中島咲(英)", "井上蓮(英)"], [N, "林悠真(英)"]], 4: [[S, "池田芽依(英)"], [Z, "清水大和(数)"]] },
    { 2: [[GROUP], [T, "山口凛(数)"]], 3: [[S, "池田芽依(国)"], [Y, "木村颯太(英)"]] },
    null,
  ],
  // 再来週: 取り込みの手順を撮るのに使う
  C: [
    null,
    { 3: [[T, "小川結衣(国)"]], 4: [[Y, "木村颯太(数)"], [I], [S, "森陽向(英)"]] },
    { 3: [[Z, "清水大和(理)"], [N, "研修"]], 4: [[I, "林悠真(数)"], [T, "【体験】松本蒼(英)"]] },
    { 4: [[S, "森陽向(国)"], [Y, "青木陽菜(英)"]], 5: [[I, "加藤美羽(数)"]] },
    { 3: [[N, "林悠真(英)"], [Y]], 4: [[Z, "清水大和(数)"]] },
    { 2: [[GROUP], [T, "山口凛(数)"]], 3: [[Y, "木村颯太(英)"], [S, "池田芽依(英)"]] },
    null,
  ],
};

function weekCsv(monday, spec) {
  const d = (x) => `${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}`;
  const lines = [`座席表,表示期間,${d(monday)}〜${d(addDays(monday, 6))}`, ""];
  spec.forEach((day, i) => {
    const date = addDays(monday, i);
    lines.push(`日付,${date.getUTCMonth() + 1}月${date.getUTCDate()}日,${WEEKDAYS[i]}`);
    if (!day) {
      lines.push("座席表未作成", "");
      return;
    }
    for (const slot of Object.keys(day).map(Number).sort()) {
      lines.push(`${slot}限,${SLOT_TIME[slot]}`, "座番,講師,生徒,生徒");
      let seat = 1;
      for (const row of day[slot]) {
        lines.push(row[0] === GROUP ? `,${GROUP}` : [seat++, ...row].join(","));
      }
    }
    lines.push("");
  });
  // 座席表の CSV は Shift_JIS (CP932)。「〜」(U+301C) は CP932 に無いので、
  // Windows が書き出すのと同じ「～」(U+FF5E) にしてから変換する
  return iconv.encode(lines.join("\r\n").replace(/〜/g, "～"), "cp932");
}
/** 画面に出るファイル名 (例: 座席表_1130-1206.xlsx 相当の CSV) */
function weekFileName(monday) {
  const md = (x) => `${String(x.getUTCMonth() + 1).padStart(2, "0")}${String(x.getUTCDate()).padStart(2, "0")}`;
  return `座席表_${md(monday)}-${md(addDays(monday, 6))}.csv`;
}

// ───────────────────────── 画面を開く・撮る ─────────────────────────
const CLEAN_CSS = `
  nextjs-portal { display: none !important; }
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
  html { scroll-behavior: auto !important; }
`;
/** 押すところを囲む枠の色 (アプリのアクセント色 hsl(24 80% 57%)) */
const MARK = "#e9803a";
/** 画像に写す教室の電話番号 (本物の代わり) */
const DUMMY_PHONE = "03-0000-0000";

let browser;
const pages = {};
/** who: admin / tutor / tutor2 / tutor3。同じ人は同じタブを使い回す */
async function as(who) {
  if (pages[who]) return pages[who];
  const admin = who === "admin";
  const ctx = await browser.newContext({
    // 教室長の画面は PC 用だが、使い方のページに載せると縮むので、
    // 画面の並びが変わらない一番狭い幅 (lg = 1024px) で撮る
    viewport: admin ? { width: 1024, height: 820 } : { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  await ctx.addCookies([{ name: "stub_role", value: who, url: BASE }]);
  // スマホ通知のカードを「まだ ON にしていない」状態で出す (許可が無いと
  // 「ブロックされています」になる)
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.guideDpr = 2;
  pages[who] = page;
  return page;
}

async function go(page, urlPath) {
  await page.goto(BASE + urlPath, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(SETTLE_MS);
  await page.addStyleTag({ content: CLEAN_CSS });
}
/** サーバーアクションのあと、画面が落ち着くまで待つ */
const settle = (page, ms = 1200) => page.waitForTimeout(ms);

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const taken = [];

/**
 * 画面を撮って public/guide/<name>.webp に保存する。
 *  - clip:  撮る範囲。locator か locator の配列 (全部が入る範囲)。省くと画面全体
 *  - marks: オレンジの枠で囲む locator の配列 (押すところ)
 *  - numbered: 枠に 1, 2, 3… の番号を付ける (画面の見方の説明用)
 *  - viewport: true なら、いま見えている範囲だけ撮る (下のタブを写したいとき)
 *  - pad:   clip の周りに足す余白 (px)
 */
async function snap(page, name, opts = {}) {
  const { clip, marks = [], numbered = false, viewport = false, pad = 10, markPad = 5, badgeLeft = [] } = opts;
  // 直前に押したボタンの色 (マウスが乗った色) や、入力中の欄の選択を写さない
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  // 教室の電話番号 (src/lib/school.ts) は本物なので、見本の番号に書き換えて撮る
  // (public/ の画像はログインなしで見える)
  await page.evaluate((dummy) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const phone = /0\d{1,3}-\d{2,4}-\d{4}/g;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (phone.test(n.textContent)) n.textContent = n.textContent.replace(phone, dummy);
      phone.lastIndex = 0;
    }
  }, DUMMY_PHONE);
  const vp = page.viewportSize();
  let height = vp.height;
  if (!viewport) {
    // 画面全体を 1 枚に入れる。fullPage だと下に固定のタブが途中に写り込むので、
    // 窓のほうを縦に伸ばす
    await page.evaluate(() => window.scrollTo(0, 0));
    height = Math.max(vp.height, await page.evaluate(() => document.documentElement.scrollHeight));
    if (height !== vp.height) {
      await page.setViewportSize({ width: vp.width, height });
      await page.waitForTimeout(300);
      height = Math.max(height, await page.evaluate(() => document.documentElement.scrollHeight));
      await page.setViewportSize({ width: vp.width, height });
      await page.waitForTimeout(200);
    }
  }
  const boxes = [];
  for (const m of marks) boxes.push(await unionBox(m, `${name}: 枠で囲む要素`));
  await page.evaluate(
    ({ boxes, numbered, color, markPad, badgeLeft }) => {
      boxes.forEach((b, i) => {
        const el = document.createElement("div");
        el.className = "__guide_mark";
        el.style.cssText =
          `position:absolute;left:${b.x + window.scrollX - markPad}px;top:${b.y + window.scrollY - markPad}px;` +
          `width:${b.width + markPad * 2}px;height:${b.height + markPad * 2}px;box-sizing:border-box;` +
          `border:3px solid ${color};border-radius:10px;box-shadow:0 0 0 4px ${color}33;` +
          `pointer-events:none;z-index:2147483647;`;
        if (numbered) {
          const n = document.createElement("span");
          n.textContent = String(i + 1);
          // 番号は枠の右上 (左上だと項目名に重なる)。画面の上の端に近いときは、
          // 切れないように枠の下に出す
          const below = b.y + window.scrollY - markPad < 16;
          // badgeLeft: 右上がほかの枠の番号と重なるときに、左上に出す枠の番号 (0 始まり)
          const corner = badgeLeft.includes(i) ? "left:-9px;top:-13px" : "right:-9px;top:-13px";
          n.style.cssText =
            `position:absolute;${below ? "left:calc(50% - 12px);bottom:-20px" : corner};width:24px;height:24px;border-radius:9999px;` +
            `background:${color};color:#fff;font:700 14px/24px system-ui,sans-serif;text-align:center;` +
            `box-shadow:0 0 0 2px #fff;`;
          el.appendChild(n);
        }
        document.body.appendChild(el);
      });
    },
    { boxes, numbered, color: MARK, markPad, badgeLeft },
  );

  let rect = { x: 0, y: 0, width: vp.width, height };
  if (clip) {
    const c = await unionBox(clip, `${name}: 撮る範囲の要素`);
    let x1 = c.x, y1 = c.y, x2 = c.x + c.width, y2 = c.y + c.height;
    // 枠 (と番号の丸) がはみ出さないよう、枠も範囲に入れる
    const m = Math.max(markPad, 0) + 4;
    for (const b of boxes) {
      x1 = Math.min(x1, b.x - m); y1 = Math.min(y1, b.y - m);
      x2 = Math.max(x2, b.x + b.width + m);
      // 番号を下に出したときは、その分も入れる
      y2 = Math.max(y2, b.y + b.height + m + (numbered && b.y - markPad < 16 ? 18 : 0));
    }
    x1 = Math.max(0, Math.floor(x1 - pad)); y1 = Math.max(0, Math.floor(y1 - pad));
    x2 = Math.min(vp.width, Math.ceil(x2 + pad)); y2 = Math.min(height, Math.ceil(y2 + pad));
    rect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
  const png = await page.screenshot({ clip: rect });
  await page.evaluate(() => document.querySelectorAll(".__guide_mark").forEach((e) => e.remove()));
  if (!viewport && height !== vp.height) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(150);
  }

  const file = path.join(OUT_DIR, `${name}.webp`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = await sharp(png).webp({ quality: 84, effort: 6, smartSubsample: true }).toFile(file);
  manifest[name] = { w: out.width, h: out.height, dpr: page.guideDpr };
  taken.push(name);
  console.log(`  撮影 ${name} (${out.width}x${out.height}, ${Math.round(out.size / 1024)}KB)`);
}

/** locator か locator の配列を、全部が入る 1 つの四角にする */
async function unionBox(target, what) {
  const list = Array.isArray(target) ? target : [target];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const l of list) {
    const b = await l.first().boundingBox();
    if (!b) throw new Error(`${what}が見つかりません`);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function saveManifest() {
  // 撮らなくなった画像 (ファイルが無いもの) は一覧から外す
  const kept = Object.keys(manifest).filter((k) => fs.existsSync(path.join(OUT_DIR, `${k}.webp`)));
  const sorted = Object.fromEntries(kept.sort().map((k) => [k, manifest[k]]));
  fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
}

/** 講習の名前 (撮る時期に合わせる) */
function seasonName(d) {
  const m = d.getUTCMonth() + 1;
  if (m === 12 || m === 1) return "冬期講習";
  if (m === 3 || m === 4) return "春期講習";
  if (m === 7 || m === 8) return "夏期講習";
  return "特別講習";
}

// ───────────────────────── 見本のデータを入れ直す ─────────────────────────
async function seed() {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    // 講師を消すと、シフト・申請・通知なども一緒に消える (cascade)
    await sql`truncate table profiles, shift_uploads, students, announcements, monthly_schedules, app_settings, periods, regular_shift_periods restart identity cascade`;
    for (const p of Object.values(CAST)) {
      await sql`
        insert into profiles (id, auth_user_id, display_name, email, roles, track, teachable_subjects)
        values (${p.id}, ${p.auth}, ${p.name}, ${p.email}, ${p.roles ?? ["tutor"]}::user_role[], ${p.track ?? null}, ${p.subjects ?? []})`;
    }
    // 講習: 5 週間後からの 2 週間、締切は 2 週間後
    const tStart = addDays(WEEK_A, 35);
    await sql`
      insert into periods (name, start_date, end_date, submission_deadline, created_by)
      values (${`${tStart.getUTCFullYear()}年 ${seasonName(tStart)}`}, ${iso(tStart)}, ${iso(addDays(tStart, 13))},
              (${iso(addDays(TODAY, 14))}::date + time '23:59') at time zone 'Asia/Tokyo', ${CAST.admin.id})`;
    // レギュラー: 再来月の 1 日からの 3 か月、受付は先週から、締切は 3 週間後
    const rStart = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 2, 1));
    const rEnd = new Date(Date.UTC(rStart.getUTCFullYear(), rStart.getUTCMonth() + 3, 0));
    await sql`
      insert into regular_shift_periods (label, start_date, end_date, submission_opens_at, submission_due_at, created_by)
      values (${`${rStart.getUTCFullYear()}年${rStart.getUTCMonth() + 1}-${rEnd.getUTCMonth() + 1}月`}, ${iso(rStart)}, ${iso(rEnd)},
              (${iso(addDays(TODAY, -7))}::date + time '00:00') at time zone 'Asia/Tokyo',
              (${iso(addDays(TODAY, 21))}::date + time '23:59') at time zone 'Asia/Tokyo', ${CAST.admin.id})`;
  } finally {
    await sql.end();
  }
}

// ───────────────────────── 座席表を取り込む ─────────────────────────
/** 取り込みを最後まで進める。shots を渡すと途中の画面を撮る */
async function upload(monday, spec, shots) {
  const a = await as("admin");
  await go(a, "/admin/uploads");
  if (shots) await shots.before(a);
  await a.setInputFiles("#file", { name: weekFileName(monday), mimeType: "text/csv", buffer: weekCsv(monday, spec) });
  if (shots) await shots.chosen(a);
  await a.getByRole("button", { name: "読み取り" }).click();
  await a.getByText("取り込み内容").waitFor({ timeout: 60000 });
  await settle(a, 800);
  if (shots) await shots.preview(a);
  await a.getByRole("button", { name: "確定して公開" }).click();
  await a.getByText("公開しました").waitFor({ timeout: 60000 });
  await settle(a, 600);
  if (shots) await shots.done(a);
}

// ───────────────────────── 流れ ─────────────────────────
const PHASES = {
  async seed() {
    await seed();
  },
  async upload() {
    await upload(WEEK_A, WEEK_SPECS.A);
    await upload(WEEK_B, WEEK_SPECS.B);
  },
};

/** カード (rounded-xl の枠) を、中の見出しや文で探す */
const cardWith = (page, text) =>
  page.locator("div.rounded-xl.border").filter({ hasText: text }).last();
/** 下のタブ (講師) */
const bottomNav = (page) => page.locator("nav.fixed");

/** 中身は使わないので、1 ページだけの空の PDF */
const DUMMY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
);
const SHEET_URL = (name) => `https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp-${name}/edit`;
const monthValue = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// 教室長: 進行表・講師マニュアルの URL、お知らせ、月のスケジュール
PHASES.settings = async () => {
  const a = await as("admin");
  await go(a, "/admin");
  const sheet = (title) =>
    a.locator("div.rounded-xl.border").filter({ has: a.getByRole("heading", { name: title, exact: true }) });
  const manual = sheet("講師マニュアル");
  await manual.getByLabel("講師マニュアルの URL").fill(SHEET_URL("manual"));
  await snap(a, "admin/sheet-links-input", {
    clip: [sheet("進行表"), manual],
    marks: [manual.getByLabel("講師マニュアルの URL"), manual.getByRole("button", { name: "保存" })],
    numbered: true,
  });
  await manual.getByRole("button", { name: "保存" }).click();
  await settle(a);
  await sheet("進行表").getByLabel("進行表の URL").fill(SHEET_URL("shinko"));
  await sheet("進行表").getByRole("button", { name: "保存" }).click();
  await settle(a);
  await snap(a, "admin/sheet-links-saved", {
    clip: [sheet("進行表"), sheet("講師マニュアル")],
    marks: [sheet("講師マニュアル").getByRole("button", { name: "URL を変える" })],
  });

  await go(a, "/admin/announcements");
  const form = cardWith(a, "新しいお知らせ");
  await a.locator("#announcement-title").fill("期末テスト前の授業について");
  await a.locator("#announcement-body").fill(
    "お疲れ様です。\n① 期末テストが近い生徒は、テスト範囲の確認を優先してください。\n② 授業の報告は、その日のうちに進行表へ入力をお願いします。\n③ 冬期講習のシフト希望は締切までに提出してください。",
  );
  await snap(a, "admin/announce-form", {
    clip: form,
    marks: [a.locator("#announcement-title"), a.locator("#announcement-body"), a.getByRole("button", { name: "講師全員に送る" })],
    numbered: true,
  });
  await a.getByRole("button", { name: "講師全員に送る" }).click();
  await settle(a, 400);
  await snap(a, "admin/announce-confirm", {
    clip: a.getByRole("alert").filter({ hasText: "送りますか" }),
    marks: [a.getByRole("button", { name: "送る", exact: true })],
    pad: 14,
  });
  await a.getByRole("button", { name: "送る", exact: true }).click();
  await a.getByText(/人に送りました/).waitFor({ timeout: 30000 });
  await settle(a);

  // 月のスケジュール: 今月と来月
  const ms = cardWith(a, "月のスケジュール（PDF）");
  const nextMonth = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 1, 1));
  for (const [i, m] of [TODAY, nextMonth].entries()) {
    await a.locator("#ms-month").fill(monthValue(m));
    await a.locator("#ms-file").setInputFiles({
      name: `schedule-${monthValue(m)}.pdf`,
      mimeType: "application/pdf",
      buffer: DUMMY_PDF,
    });
    if (i === 1) {
      await snap(a, "admin/monthly-schedule", {
        clip: ms,
        marks: [a.locator("#ms-month"), a.locator("#ms-file"), ms.getByRole("button", { name: "アップロード" })],
        numbered: true,
      });
    }
    await ms.getByRole("button", { name: /アップロード|置き換える/ }).click();
    await ms.getByRole("status").waitFor({ timeout: 30000 });
    await settle(a);
  }
};

// 講師: ホーム・お知らせ・月のスケジュール・通知・マイページ
PHASES.tutorHome = async () => {
  const t = await as("tutor");
  await go(t, "/tutor");
  const hero = t.locator("section").filter({ hasText: "今週のコマ" }).first();
  const next = t.locator("section").filter({ hasText: "次の出勤" }).first();
  const week = t.locator("section#week");
  const notice = t.getByRole("link", { name: /教室長からのお知らせが/ });
  const links = [t.getByRole("link", { name: "進行表を開く" }), t.getByRole("link", { name: "月のスケジュール" })];
  await snap(t, "tutor/home-overview", {
    clip: [t.locator("header"), ...links],
    marks: [hero, notice, next, week, links],
    numbered: true,
    pad: 16,
  });
  await snap(t, "tutor/header", {
    clip: t.locator("header"),
    marks: [
      t.getByRole("link", { name: /教室に電話する/ }),
      t.getByRole("link", { name: /^通知/ }),
      t.getByRole("link", { name: "アプリの使い方" }),
      t.getByRole("link", { name: /マイページ/ }),
    ],
    numbered: true,
    markPad: 1,
    pad: 18,
  });
  await snap(t, "tutor/home-week", {
    clip: week,
    marks: [t.getByRole("link", { name: "次の週" }), t.getByRole("button", { name: "今週のシフトを確認しました" })],
    numbered: true,
  });
  // 来週: 未定・研修・体験 の印
  await go(t, "/tutor?week=1");
  await snap(t, "tutor/home-next-week", { clip: t.locator("section#week") });
  // 確認しました
  await go(t, "/tutor");
  await t.getByRole("button", { name: "今週のシフトを確認しました" }).click();
  await t.getByText(/確認済み/).waitFor({ timeout: 30000 });
  await settle(t, 600);
  await snap(t, "tutor/home-confirmed", { clip: t.locator("section#week"), marks: [t.getByText(/確認済み/)] });

  // 下のタブ
  for (const [name, tab] of [["tab-regular", "レギュラー"], ["tab-training", "講習"], ["tab-absence", "欠勤等"]]) {
    await snap(t, `tutor/${name}`, {
      viewport: true,
      clip: bottomNav(t),
      marks: [bottomNav(t).getByRole("link", { name: tab })],
      markPad: -4,
      pad: 0,
    });
  }

  // ホームの下のリンク
  await snap(t, "tutor/home-links", {
    clip: [t.getByRole("link", { name: "進行表を開く" }), t.getByRole("link", { name: "月のスケジュール" })],
  });

  // お知らせ
  await go(t, "/tutor/announcements");
  await snap(t, "tutor/announcement", {
    clip: [t.getByRole("heading", { name: "教室長からのお知らせ" }), t.getByRole("button", { name: "確認しました" })],
    marks: [t.getByRole("button", { name: "確認しました" })],
    pad: 28,
  });
  await t.getByRole("button", { name: "確認しました" }).click();
  await t.getByText(/確認済み/).waitFor({ timeout: 30000 });
  await settle(t, 600);

  // 月のスケジュール
  await go(t, "/tutor/schedules");
  await snap(t, "tutor/schedules", {
    clip: [t.getByRole("heading", { name: "月のスケジュール" }), t.getByRole("link", { name: /のスケジュール/ }).last()],
    pad: 28,
  });
};

// ───────────────────────── シフト希望 (講師) ─────────────────────────
/** レギュラーの表のコマ (aria-label が「火 4限 出勤可」の形) */
const regularCell = (page, weekday, slot) =>
  page.getByRole("button", { name: new RegExp(`^${weekday} ${slot}限 `) });
/** レギュラーの希望を入れる。cells: [[曜日, 何限, "○"|"△"]] */
async function fillRegular(page, cells) {
  for (const [w, slot, mark] of cells) {
    await regularCell(page, w, slot).click();
    if (mark === "△") await regularCell(page, w, slot).click();
  }
}
async function openRegularEditor(page) {
  await go(page, "/tutor/fixed-shifts");
  await page.locator("main a[href*='period=']").first().click();
  await page.getByText("曜日 × コマ").waitFor({ timeout: 60000 });
  await settle(page, SETTLE_MS);
  await page.addStyleTag({ content: CLEAN_CSS });
}
async function submitRegular(who, cells) {
  const t = await as(who);
  await openRegularEditor(t);
  await fillRegular(t, cells);
  await t.getByRole("button", { name: "この内容で提出" }).click();
  await t.getByText(/提出しました/).waitFor({ timeout: 30000 });
  await settle(t);
}

/** 講習の日のカード (「12/21（月）」の形の見出し) */
const trainingDay = (page, n) => page.locator("div.rounded-xl.border.p-3").nth(n);
async function openTrainingEditor(page) {
  await go(page, "/tutor/training");
  await page.locator("main a[href*='period=']").first().click();
  await page.getByRole("button", { name: "提出する" }).or(page.getByRole("button", { name: "修正する" })).first().waitFor({ timeout: 60000 });
  await settle(page, SETTLE_MS);
  await page.addStyleTag({ content: CLEAN_CSS });
}
/** 講習の希望を入れる。picks: { 何日目(0〜): [何限, ...] | "all" } */
async function fillTraining(page, picks) {
  for (const [n, slots] of Object.entries(picks)) {
    const day = trainingDay(page, Number(n));
    if (slots === "all") {
      await day.getByRole("button", { name: "全部選択" }).click();
    } else {
      for (const slot of slots) await day.getByRole("button", { name: `${slot}限` }).click();
    }
    await page.waitForTimeout(250);
  }
  // 自動保存が終わるのを待つ
  await page.waitForTimeout(1500);
}
async function submitTraining(who, picks) {
  const t = await as(who);
  await openTrainingEditor(t);
  await fillTraining(t, picks);
  await t.getByRole("button", { name: "提出する" }).click();
  await t.getByText("提出しました。").waitFor({ timeout: 30000 });
  await settle(t);
}

PHASES.tutorRegular = async () => {
  const t = await as("tutor");
  await go(t, "/tutor/fixed-shifts");
  const period = t.locator("main a[href*='period=']").first();
  await snap(t, "tutor/regular-list", {
    clip: [t.getByRole("heading", { name: "レギュラーシフト提出" }), period],
    marks: [period],
    pad: 28,
  });
  await openRegularEditor(t);
  await fillRegular(t, [["火", 4, "○"], ["木", 5, "○"], ["土", 3, "○"], ["金", 3, "○"], ["水", 3, "△"], ["土", 2, "△"]]);
  await snap(t, "tutor/regular-grid", {
    clip: [t.locator("div.grid").filter({ has: regularCell(t, "月", 1) }), t.getByText("タップごとに")],
    marks: [regularCell(t, "火", 4), regularCell(t, "水", 3)],
    numbered: true,
    markPad: 2,
    pad: 14,
  });
  await t.getByLabel("1 週間に出たいコマ数 (任意)").fill("4");
  const submit = t.getByRole("button", { name: "この内容で提出" });
  await snap(t, "tutor/regular-submit", {
    clip: [t.getByText(/^選択中:/), t.getByRole("button", { name: "下書き保存" })],
    marks: [submit],
    pad: 14,
  });
  await submit.click();
  await t.getByText(/提出しました/).waitFor({ timeout: 30000 });
  await settle(t);
  await snap(t, "tutor/regular-submitted", {
    clip: [t.getByText(/^選択中:/), t.getByText(/提出しました/)],
    marks: [t.getByRole("button", { name: "下書きに戻す" })],
    pad: 14,
  });
  // ほかの講師の分 (教室長の画面で使う)
  await submitRegular("tutor2", [["火", 3, "○"], ["水", 4, "○"], ["木", 4, "○"], ["土", 2, "○"], ["金", 4, "△"]]);
  await submitRegular("tutor3", [["火", 4, "○"], ["水", 4, "○"], ["木", 5, "○"], ["金", 3, "△"], ["土", 3, "○"]]);
};

PHASES.tutorTraining = async () => {
  const t = await as("tutor");
  await go(t, "/tutor/training");
  const period = t.locator("main a[href*='period=']").first();
  await snap(t, "tutor/training-list", {
    clip: [t.getByRole("heading", { name: "講習シフト提出" }), period],
    marks: [period],
    pad: 28,
  });
  await openTrainingEditor(t);
  await fillTraining(t, { 0: [3, 4], 1: "all", 2: [4, 5], 4: [1, 2, 3], 7: [3, 4], 8: [4] });
  await snap(t, "tutor/training-days", {
    clip: [t.getByText("出勤できるコマをタップして選んでください"), trainingDay(t, 2)],
    marks: [trainingDay(t, 0).getByRole("button", { name: "3限" }), trainingDay(t, 1).getByRole("button", { name: "全解除" })],
    numbered: true,
    markPad: 2,
    pad: 12,
  });
  const submit = t.getByRole("button", { name: "提出する" });
  await snap(t, "tutor/training-submit", {
    clip: [t.getByText(/^選択 \d+ コマ/), t.getByText("一時保存のままだと教室長には届きません。")],
    marks: [submit],
    pad: 14,
  });
  await submit.click();
  await t.getByText("提出しました。").waitFor({ timeout: 30000 });
  await settle(t);
  await snap(t, "tutor/training-submitted", {
    clip: [t.getByText(/^選択 \d+ コマ/), t.getByRole("button", { name: "一覧へ戻る" })],
    marks: [t.getByRole("button", { name: "修正する" })],
    pad: 14,
  });
  await submitTraining("tutor2", { 0: [3, 4], 2: [3, 4], 3: "all", 7: [3], 8: [3, 4] });
  await submitTraining("tutor3", { 0: [4, 5], 1: [3, 4], 2: [4], 4: [2, 3], 9: [3, 4] });
};

PHASES.tutorMe = async () => {
  const t = await as("tutor");
  await go(t, "/tutor/me");
  const profile = cardWith(t, "登録した内容");
  await snap(t, "tutor/me-profile", { clip: profile, marks: [t.getByRole("button", { name: "編集する" })] });
  await t.getByRole("button", { name: "編集する" }).click();
  await settle(t, 500);
  await snap(t, "tutor/me-profile-edit", {
    clip: [cardWith(t, "理系・文系"), t.getByRole("button", { name: "保存する" })],
    marks: [cardWith(t, "理系・文系"), cardWith(t, "教えられる科目をすべてタップ"), t.getByRole("button", { name: "保存する" })],
    numbered: true,
    markPad: 2,
  });
  await go(t, "/tutor/me");
  const reminder = cardWith(t, "出勤前の通知");
  await reminder.getByRole("button", { name: "2時間前" }).click();
  await reminder.getByRole("status").waitFor({ timeout: 30000 });
  await settle(t, 500);
  await snap(t, "tutor/me-reminder", { clip: reminder, marks: [reminder.getByRole("button", { name: "2時間前" })], markPad: 2 });
};

// ───────────────────────── 座席表の取り込み (教室長) ─────────────────────────
PHASES.adminUpload = async () => {
  await upload(WEEK_C, WEEK_SPECS.C, {
    async before(a) {
      await snap(a, "admin/nav-upload", {
        clip: a.locator("header"),
        marks: [a.locator("header nav").getByRole("link", { name: "Excel取り込み" })],
        markPad: 1,
        pad: 0,
      });
    },
    async chosen(a) {
      await snap(a, "admin/upload-file", {
        clip: cardWith(a, "座席表ファイルを選択"),
        marks: [a.locator("#file"), a.getByRole("button", { name: "読み取り" })],
        numbered: true,
      });
    },
    async preview(a) {
      await snap(a, "admin/upload-summary", { clip: cardWith(a, "取り込み内容") });
      await snap(a, "admin/upload-mapping", { clip: cardWith(a, "講師の対応付け") });
      await snap(a, "admin/upload-publish", {
        clip: [cardWith(a, "日別サマリ"), a.getByRole("button", { name: "確定して公開" })],
        marks: [a.getByRole("button", { name: "確定して公開" })],
      });
    },
    async done(a) {
      await snap(a, "admin/upload-done", { clip: cardWith(a, "公開しました") });
    },
  });
};

// ───────────────────────── 欠勤・代講・休み希望の流れ ─────────────────────────
/** 画面の「11/27（金） 3限」の形 */
const slotText = (d, slot) => `${label(d)} ${slot}限`;
/** 講師の欠勤申請の「対象のシフト」の 1 行 */
const absenceTarget = (page, d, slot) => page.locator("label").filter({ hasText: slotText(d, slot) });
/** 教室長の申請承認のカード (名前と日付で探す) */
const requestCard = (page, name, d, slot) =>
  page.locator("div.rounded-lg.border").filter({ hasText: name }).filter({ hasText: slotText(d, slot) }).first();
/** 見出しの付いた区切り (申請承認の「欠勤申請」など) */
const sectionOf = (page, heading) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
/** 画面の一番上の紺の箱 (見出しで探す) */
const heroOf = (page, heading) =>
  page.locator("section.bg-primary").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
/** 講師の「欠勤等」の上の切り替え */
const requestsNav = (page) => page.locator("main nav").first();

async function fillAbsence(page, d, slot, category, memo) {
  await absenceTarget(page, d, slot).click();
  await page.locator("label").filter({ hasText: new RegExp(`^${category}$`) }).click();
  await page.getByPlaceholder("例: 通院のため").fill(memo);
}
async function sendAbsence(page) {
  await page.getByRole("button", { name: /欠勤を申請$/ }).click();
  await page.getByText(/欠勤申請を.*送信しました/).waitFor({ timeout: 30000 });
  await settle(page);
}
async function tutorAbsence(who, d, slot, category, memo) {
  const t = await as(who);
  await go(t, "/tutor/absences");
  await fillAbsence(t, d, slot, category, memo);
  await sendAbsence(t);
}
/** 教室長: 欠勤を承認する。how = "designate" | "recruit" | "none" */
async function chooseFollowUp(card, how, names = []) {
  const text = { designate: "代講を指名する", recruit: "代講を募集に出す", none: "何もしない" }[how];
  await card.getByLabel(text).check();
  for (const n of names) await card.locator("label").filter({ hasText: n }).click();
}
async function approveAbsence(page, card) {
  await card.getByRole("button", { name: "承認", exact: true }).click();
  await page.getByText(/^承認(しました|し、)/).first().waitFor({ timeout: 30000 });
  await settle(page);
}
/** 講師の代講募集のカード (休む人の名前と日付で探す) */
const swapCard = (page, requester, d, slot) =>
  page.locator("div.rounded-xl.border").filter({ hasText: `${requester} さんの代講` }).filter({ hasText: slotText(d, slot) }).first();

PHASES.flows = async () => {
  const t = await as("tutor");
  const a = await as("admin");
  const t3 = await as("tutor3");
  /** 来週の曜日 (0=月) */
  const B = (weekday) => dayOf(WEEK_B, weekday);

  // ① 山田さんが、来週 金曜 3限 (体験の授業) の欠勤を申請する
  await go(t, "/tutor/absences");
  await snap(t, "tutor/absence-nav", {
    clip: [requestsNav(t), heroOf(t, "欠勤申請")],
    marks: [requestsNav(t).getByRole("link", { name: "欠勤申請" })],
    markPad: 1,
    pad: 16,
  });
  await fillAbsence(t, B(4), 3, "私用", "大学のゼミ発表のため");
  const absForm = cardWith(t, "新しい欠勤申請");
  await snap(t, "tutor/absence-target", {
    clip: [absForm.getByText("新しい欠勤申請"), absenceTarget(t, B(5), 2)],
    marks: [absenceTarget(t, B(4), 3)],
    markPad: 3,
    pad: 16,
  });
  await snap(t, "tutor/absence-reason", {
    clip: [absForm.locator("fieldset").filter({ hasText: "体調不良" }), t.getByRole("button", { name: /欠勤を申請$/ })],
    marks: [
      absForm.locator("fieldset").filter({ hasText: "体調不良" }),
      t.getByPlaceholder("例: 通院のため"),
      t.getByRole("button", { name: /欠勤を申請$/ }),
    ],
    numbered: true,
    markPad: 3,
    pad: 16,
  });
  await sendAbsence(t);
  const history = cardWith(t, "申請履歴");
  await snap(t, "tutor/absence-pending", { clip: history, marks: [history.getByRole("button", { name: "取り消し" })], markPad: 2 });
  await snap(t, "tutor/absence-phone", {
    clip: t.locator("header"),
    marks: [t.getByRole("link", { name: /教室に電話する/ })],
    markPad: 1,
    pad: 0,
  });

  // ② ほかの講師の欠勤申請
  await tutorAbsence("tutor2", B(1), 3, "学業", "大学の試験のため"); // 未対応のまま残す
  await tutorAbsence("tutor2", B(3), 4, "体調不良", "通院のため"); // 山田さんを指名する
  await tutorAbsence("tutor3", B(2), 4, "私用", "家の用事のため"); // 募集に出す

  // ③ 教室長: 申請承認
  await go(a, "/admin/requests");
  await snap(a, "admin/requests-overview", {
    clip: [a.getByRole("heading", { name: "申請承認" }), sectionOf(a, "欠勤申請").locator("div.rounded-lg.border").first()],
    marks: [
      [a.getByRole("button", { name: "室長が欠勤を登録する" }), a.getByRole("button", { name: "室長が代講を募集する" })],
      a.locator("nav[aria-label='表示の切り替え']"),
      sectionOf(a, "欠勤申請").getByRole("heading"),
    ],
    numbered: true,
    markPad: 4,
    pad: 16,
  });
  // 山田さんの欠勤 → 高橋さん・伊藤さんを指名して承認
  let card = requestCard(a, Y, B(4), 3);
  await chooseFollowUp(card, "designate", [T, I]);
  await snap(a, "admin/absence-designate", {
    clip: card,
    marks: [
      card.locator("label").filter({ hasText: "代講を指名する" }),
      card.locator("fieldset fieldset"),
      card.getByRole("button", { name: "承認", exact: true }),
    ],
    numbered: true,
    markPad: 3,
  });
  await approveAbsence(a, card);
  // 高橋さんの木曜 4限 → 山田さんを指名
  card = requestCard(a, T, B(3), 4);
  await chooseFollowUp(card, "designate", [Y]);
  await approveAbsence(a, card);
  // 伊藤さんの水曜 4限 → 募集に出す
  card = requestCard(a, I, B(2), 4);
  await chooseFollowUp(card, "recruit");
  await snap(a, "admin/absence-recruit", {
    clip: card,
    marks: [card.locator("label").filter({ hasText: "代講を募集に出す" }), card.getByRole("button", { name: "承認", exact: true })],
    numbered: true,
    markPad: 3,
  });
  await approveAbsence(a, card);
  // 却下の入力欄 (高橋さんの火曜 3限。却下はしない)
  card = requestCard(a, T, B(1), 3);
  await card.getByRole("button", { name: "却下", exact: true }).click();
  await card.getByPlaceholder(/却下の理由/).fill("この日は代わりの講師が見つからないため、出勤をお願いします。");
  await snap(a, "admin/absence-reject", {
    clip: card,
    marks: [card.getByPlaceholder(/却下の理由/), card.getByRole("button", { name: "却下を確定" })],
    numbered: true,
    markPad: 3,
  });
  await card.getByRole("button", { name: "やめる" }).click();

  // ④ 教室長: 電話で受けた欠勤を登録する (佐藤さんの金曜 4限 → 伊藤さんを指名)
  await a.getByRole("button", { name: "室長が欠勤を登録する" }).click();
  await a.locator("#on-behalf-date").fill(iso(B(4)));
  await a.locator(`#on-behalf-slot option[value="${CAST.sato.id}|4"]`).waitFor({ state: "attached", timeout: 30000 });
  await a.locator("#on-behalf-slot").selectOption(`${CAST.sato.id}|4`);
  await a.locator("#on-behalf-reason").fill("電話連絡あり、発熱のため");
  const proxy = a.locator("div.rounded-xl.border").filter({ has: a.locator("#on-behalf-date") });
  await chooseFollowUp(proxy, "designate", []);
  await proxy.locator("fieldset fieldset label").filter({ hasText: I }).click();
  await snap(a, "admin/proxy-absence", {
    clip: proxy,
    marks: [
      a.locator("#on-behalf-date"),
      a.locator("#on-behalf-slot"),
      a.locator("#on-behalf-reason"),
      proxy.locator("fieldset").first(),
      proxy.getByRole("button", { name: "登録する" }),
    ],
    numbered: true,
    markPad: 3,
  });
  await proxy.getByRole("button", { name: "登録する" }).click();
  await a.getByText(/登録しました。/).waitFor({ timeout: 30000 });
  await settle(a);

  // ⑤ 山田さん: 欠勤の履歴 (返事待ち) と、代講の依頼・募集
  await go(t, "/tutor/absences");
  await snap(t, "tutor/absence-requested", { clip: cardWith(t, "申請履歴") });
  await go(t, "/tutor/open-swaps");
  await snap(t, "tutor/sub-nav", {
    clip: [requestsNav(t), heroOf(t, "代講募集")],
    marks: [requestsNav(t).getByRole("link", { name: "代講募集" })],
    markPad: 1,
    pad: 28,
  });
  const asked = swapCard(t, T, B(3), 4);
  await snap(t, "tutor/sub-asked", {
    clip: asked,
    marks: [asked.getByRole("button", { name: "引き受ける" }), asked.getByRole("button", { name: "断る" })],
    numbered: true,
    markPad: 3,
  });
  const open = swapCard(t, I, B(2), 4);
  await snap(t, "tutor/sub-open", { clip: open, marks: [open.getByRole("button", { name: "応募する" })], markPad: 3 });
  await open.getByRole("button", { name: "応募する" }).click();
  await t.getByText("応募しました。").waitFor({ timeout: 30000 });
  await settle(t);
  await snap(t, "tutor/sub-applied", {
    clip: swapCard(t, I, B(2), 4),
    marks: [swapCard(t, I, B(2), 4).getByRole("button", { name: "応募を取り下げる" })],
    markPad: 3,
  });

  // ⑥ 伊藤さん: 山田さんの分は引き受け、佐藤さんの分は断る
  await go(t3, "/tutor/open-swaps");
  const refuse = swapCard(t3, S, B(4), 4);
  await refuse.getByRole("button", { name: "断る" }).click();
  await settle(t3, 400);
  await snap(t3, "tutor/sub-decline", {
    clip: refuse,
    marks: [refuse.getByRole("button", { name: "断る" })],
    markPad: 3,
  });
  await refuse.getByRole("button", { name: "断る" }).click();
  await t3.getByText("断りました。").waitFor({ timeout: 30000 });
  await settle(t3);
  await swapCard(t3, Y, B(4), 3).getByRole("button", { name: "引き受ける" }).click();
  await t3.getByText(/引き受けました/).waitFor({ timeout: 30000 });
  await settle(t3);

  // ⑦ 山田さん: 代講が決まった欠勤
  await go(t, "/tutor/absences");
  await snap(t, "tutor/absence-decided", { clip: cardWith(t, "申請履歴") });

  // ⑧ 教室長: 代講が決まっていない欠勤、応募者から選ぶ、ダッシュボード
  await go(a, "/admin/requests");
  const unfilled = sectionOf(a, "代講が決まっていない欠勤");
  const declined = unfilled.locator("div.rounded-lg.border").filter({ hasText: "代講未定" }).first();
  await snap(a, "admin/unfilled", {
    clip: unfilled,
    marks: [
      [declined.locator("select"), declined.getByRole("button", { name: "指名する" })],
      declined.getByRole("button", { name: "代講を募集に出す" }),
    ],
    numbered: true,
    markPad: 3,
  });
  const swaps = sectionOf(a, "交代・代講");
  const approve = swaps.getByRole("button", { name: `${Y} を承認` });
  await snap(a, "admin/swap-applicants", {
    clip: swaps,
    marks: [approve, swaps.getByRole("button", { name: "募集を取り下げる" })],
    numbered: true,
    markPad: 3,
  });
  await go(a, "/admin");
  await snap(a, "admin/dashboard", {
    marks: [
      a.locator("div.grid").filter({ hasText: "今週の確定コマ" }).first(),
      [cardWith(a, "進行表を開く"), cardWith(a, "講師マニュアルを開く")],
      a.locator("div.space-y-4").filter({ has: a.getByRole("heading", { name: "承認待ちの申請" }) }),
      a.locator("div.space-y-4").filter({ has: a.getByRole("heading", { name: "今週の充足状況" }) }),
    ],
    numbered: true,
    markPad: 4,
  });

  // ⑨ 山田さんが高橋さんの代講を引き受け、教室長が募集の応募 (山田さん) を承認する
  await go(t, "/tutor/open-swaps");
  await swapCard(t, T, B(3), 4).getByRole("button", { name: "引き受ける" }).click();
  await t.getByText(/引き受けました/).waitFor({ timeout: 30000 });
  await settle(t);
  await go(a, "/admin/requests");
  await sectionOf(a, "交代・代講").getByRole("button", { name: `${Y} を承認` }).click();
  await settle(a, 2500);
  await go(t, "/tutor?week=1");
  await snap(t, "tutor/home-after-sub", { clip: t.locator("section#week") });

  // ⑩ 休み希望 (シフトがまだ出ていない先の日)
  const off1 = addDays(WEEK_C, 9);
  const off2 = addDays(WEEK_C, 12);
  await go(t, "/tutor/day-offs");
  await snap(t, "tutor/dayoff-nav", {
    clip: [requestsNav(t), heroOf(t, "休み希望")],
    marks: [requestsNav(t).getByRole("link", { name: "休み希望" })],
    markPad: 1,
    pad: 28,
  });
  await t.locator("#day-off-date").fill(iso(off1));
  await t.locator("#day-off-reason").fill("大学の用事が入ったため");
  const offForm = cardWith(t, "休み希望を出す");
  await snap(t, "tutor/dayoff-form", {
    clip: offForm,
    marks: [
      t.locator("#day-off-date"),
      [t.getByRole("button", { name: "終日" }), t.getByRole("button", { name: "コマを選ぶ" })],
      t.locator("#day-off-reason"),
      offForm.getByRole("button", { name: /休み希望を出す$/ }),
    ],
    numbered: true,
    markPad: 3,
  });
  await offForm.getByRole("button", { name: /休み希望を出す$/ }).click();
  await t.getByText(/休み希望を.*出しました/).waitFor({ timeout: 30000 });
  await settle(t);
  const offHistory = cardWith(t, "出した休み希望");
  await snap(t, "tutor/dayoff-pending", { clip: offHistory, marks: [offHistory.getByRole("button", { name: "取り下げる" })], markPad: 2 });
  // 高橋さん: コマを選んで出す
  const t2 = await as("tutor2");
  await go(t2, "/tutor/day-offs");
  await t2.locator("#day-off-date").fill(iso(off2));
  await t2.getByRole("button", { name: "コマを選ぶ" }).click();
  await t2.getByRole("button", { name: "2限" }).click();
  await t2.getByRole("button", { name: "3限" }).click();
  await t2.locator("#day-off-reason").fill("資格試験を受けるため");
  await cardWith(t2, "休み希望を出す").getByRole("button", { name: /休み希望を出す$/ }).click();
  await t2.getByText(/休み希望を.*出しました/).waitFor({ timeout: 30000 });
  // 教室長: 休み希望を承認する
  await go(a, "/admin/requests");
  const offs = sectionOf(a, "休み希望（シフト公開前の日）");
  const offCard = offs.locator("div.rounded-xl.border").filter({ hasText: T }).first();
  await snap(a, "admin/dayoff", {
    clip: offs,
    marks: [offCard.getByRole("button", { name: "承認する" }), offCard.getByRole("button", { name: "却下", exact: true })],
    numbered: true,
    markPad: 3,
  });
  await offCard.getByRole("button", { name: "承認する" }).click();
  await settle(a, 2000);
};

// ───────────────────────── 通知 (講師) ─────────────────────────
PHASES.tutorNotifications = async () => {
  const t = await as("tutor");
  await go(t, "/tutor");
  await snap(t, "tutor/bell", {
    clip: t.locator("header"),
    marks: [t.getByRole("link", { name: /^通知/ })],
    markPad: 1,
    pad: 0,
  });
  await go(t, "/tutor/notifications");
  const push = cardWith(t, "スマホ通知");
  await t.getByRole("button", { name: "この端末で通知を受け取る" }).waitFor({ timeout: 30000 });
  await snap(t, "tutor/push", {
    clip: push,
    marks: [push.getByRole("button", { name: "この端末で通知を受け取る" })],
    markPad: 3,
  });
  const items = t.locator("main ul.space-y-2 > li");
  await snap(t, "tutor/notifications", { clip: [items.first(), items.nth(4)], pad: 12 });
};

// ───────────────────────── 締切後の変更申請 ─────────────────────────
PHASES.changeRequest = async () => {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  const t = await as("tutor");
  const a = await as("admin");
  const openTraining = async () => {
    await go(t, "/tutor/training");
    await t.locator("main a[href*='period=']").first().click();
    await t.getByText("← 講習期間の一覧へ").waitFor({ timeout: 60000 });
    await settle(t, SETTLE_MS);
    await t.addStyleTag({ content: CLEAN_CSS });
  };
  try {
    // 講習の締切が過ぎたことにする
    await sql`update periods set submission_deadline = now() - interval '2 days'`;
    await openTraining();
    await t.getByLabel("変更したい理由").fill("大学の補講が入り、出られない日ができたため");
    await snap(t, "tutor/change-form", {
      clip: cardWith(t, "提出期間が終わっているため"),
      marks: [t.getByLabel("変更したい理由"), t.getByRole("button", { name: "変更申請を出す" })],
      numbered: true,
      markPad: 3,
    });
    await t.getByRole("button", { name: "変更申請を出す" }).click();
    await t.getByText("変更申請を出しました。").waitFor({ timeout: 30000 });
    await settle(t);
    await snap(t, "tutor/change-pending", { clip: cardWith(t, "変更申請を出しました。") });

    // 教室長: 変更申請を承認する
    await go(a, "/admin/requests");
    const changes = sectionOf(a, "シフトの変更申請（提出期間外）");
    await snap(a, "admin/change-request", {
      clip: changes,
      marks: [changes.getByRole("button", { name: "承認する" }), changes.getByRole("button", { name: "却下", exact: true })],
      numbered: true,
      markPad: 3,
    });
    await changes.getByRole("button", { name: "承認する" }).click();
    await settle(a, 2500);

    // 講師: 変更できるようになった
    await openTraining();
    const unlocked = cardWith(t, "教室長が変更を認めました。");
    await snap(t, "tutor/change-approved", {
      clip: unlocked,
      marks: [unlocked.getByRole("button", { name: "変更を終える" })],
      markPad: 3,
    });

    // 教室長: 申請を待たずに 1 人だけ再開する
    await openAdminTraining(a);
    const grant = cardWith(a, "締切後に、選んだ講師だけ");
    await a.getByLabel("再開する講師").selectOption({ label: T });
    await snap(a, "admin/grant-change", {
      clip: grant,
      marks: [a.getByLabel("再開する講師"), grant.getByRole("button", { name: "再開する" })],
      numbered: true,
      markPad: 3,
    });
  } finally {
    // 締切を元に戻す (あとの段階は、受付中の状態で撮る)
    await sql`update periods set submission_deadline = (${iso(addDays(TODAY, 14))}::date + time '23:59') at time zone 'Asia/Tokyo'`;
    await sql.end();
  }
};

// ───────────────────────── 教室長のそのほかの画面 ─────────────────────────
/** 上のメニューの下に出る切り替え (講師 / 担当科目 / 教室長 など) */
const sectionNav = (page) => page.locator("main nav.bg-muted").first();
async function openAdminTraining(a) {
  await go(a, "/admin/training");
  await a.locator("main a[href*='period=']").first().click();
  await a.getByText("← 講習期間の一覧へ").waitFor({ timeout: 60000 });
  await settle(a, SETTLE_MS);
  await a.addStyleTag({ content: CLEAN_CSS });
}

PHASES.adminScreens = async () => {
  const a = await as("admin");
  const topNav = a.locator("header nav");

  // 上のメニューと、通知・使い方
  await go(a, "/admin");
  await snap(a, "admin/header", {
    clip: a.locator("header"),
    marks: [
      [topNav.getByRole("link").first(), topNav.getByRole("link").last()],
      a.locator("header").getByRole("link", { name: /^通知/ }),
      a.locator("header").getByRole("link", { name: "使い方" }),
    ],
    numbered: true,
    badgeLeft: [0],
    markPad: 1,
    pad: 0,
  });

  // 登録済みシフト (来週: 欠勤・代講・研修・体験・未定 が全部ある)
  // この画面だけは横に広いので、普通の PC の幅で撮る (狭いとボタンの字が折り返す)
  const narrow = a.viewportSize();
  await a.setViewportSize({ width: 1280, height: narrow.height });
  await go(a, `/admin/weekly?week=${iso(WEEK_B)}`);
  const grid = a.locator("div.weekly-grid");
  await snap(a, "admin/weekly", {
    clip: [a.locator("div.rounded-lg.border").filter({ hasText: "確認済み" }).first(), grid],
    marks: [
      [a.getByRole("link", { name: "前週" }), a.getByLabel("週の日付を指定")],
      [a.getByLabel("講師で絞り込み"), a.getByRole("button", { name: "印刷" })],
    ],
    numbered: true,
    markPad: 3,
    pad: 14,
  });
  const undo = a.getByRole("button", { name: "この週の登録を取り消す" });
  await snap(a, "admin/weekly-undo", {
    clip: [undo, a.getByText("間違えて取り込んだときに使います。")],
    marks: [undo],
    markPad: 3,
    pad: 14,
  });
  await a.setViewportSize(narrow);
  // 今週: 講師の「確認しました」
  await go(a, `/admin/weekly?week=${iso(WEEK_A)}`);
  await snap(a, "admin/weekly-confirmed", {
    clip: a.locator("div.rounded-lg.border").filter({ hasText: "確認済み" }).first(),
    pad: 12,
  });

  // 申請承認: 室長が代講を募集する (入れるだけで、募集はしない)
  await go(a, "/admin/requests");
  await a.getByRole("button", { name: "室長が代講を募集する" }).click();
  const recruitDay = dayOf(WEEK_C, 1);
  await a.locator("#on-behalf-swap-date").fill(iso(recruitDay));
  await a.locator(`#on-behalf-swap-slot option[value="${CAST.tutor2.id}|3"]`).waitFor({ state: "attached", timeout: 30000 });
  await a.locator("#on-behalf-swap-slot").selectOption(`${CAST.tutor2.id}|3`);
  await a.locator("#on-behalf-swap-reason").fill("体調不良による欠勤のため代講を募集");
  const recruit = a.locator("div.rounded-xl.border").filter({ has: a.locator("#on-behalf-swap-date") });
  await snap(a, "admin/proxy-recruit", {
    clip: recruit,
    marks: [
      a.locator("#on-behalf-swap-date"),
      a.locator("#on-behalf-swap-slot"),
      a.locator("#on-behalf-swap-reason"),
      recruit.getByRole("button", { name: "募集する" }),
    ],
    numbered: true,
    markPad: 3,
  });
  await recruit.getByRole("button", { name: "やめる" }).click();

  // 申請承認の「記録」
  await go(a, "/admin/requests?tab=log");
  const logCards = a.locator("main div.rounded-xl.border").filter({ hasText: "理由:" });
  const absenceLog = logCards.filter({ has: a.getByRole("button", { name: "承認前に戻す" }) }).first();
  await snap(a, "admin/log-tab", {
    clip: [a.locator("nav[aria-label='表示の切り替え']"), a.locator("#log-state")],
    marks: [
      a.locator("nav[aria-label='表示の切り替え']").getByRole("link", { name: "記録" }),
      [a.locator("#log-period"), a.locator("#log-state")],
    ],
    numbered: true,
    markPad: 3,
    pad: 14,
  });
  await snap(a, "admin/log-absence", {
    clip: absenceLog,
    marks: [absenceLog.getByRole("button", { name: "承認前に戻す" }), absenceLog.getByRole("button", { name: "この欠勤を取り消す" })],
    numbered: true,
    markPad: 3,
  });
  await logCards.getByRole("button", { name: "この代講を取り消す" }).first().click();
  // 押すとボタンが理由の欄に変わるので、理由の欄があるカードを探す
  const swapLog = logCards.filter({ has: a.getByPlaceholder("取り消しの理由を入力（講師に表示されます）") }).first();
  await swapLog.getByPlaceholder("取り消しの理由を入力（講師に表示されます）").fill("代講の講師の都合が悪くなったため");
  await snap(a, "admin/log-swap-cancel", {
    clip: swapLog,
    marks: [swapLog.getByPlaceholder("取り消しの理由を入力（講師に表示されます）"), swapLog.getByRole("button", { name: "取り消す", exact: true })],
    numbered: true,
    markPad: 3,
  });
  await swapLog.getByRole("button", { name: "やめる" }).click();

  // 講師管理
  await go(a, "/admin/tutors");
  await a.getByText("招待中", { exact: true }).waitFor({ timeout: 30000 });
  const tutorNames = [Y, T, I, S, Z, N, CAST.nakamura.name];
  const tutorRow = (name) => a.locator("div.border-b").filter({ has: a.getByRole("link", { name, exact: true }) }).last();
  await snap(a, "admin/tutors-list", {
    clip: [a.getByRole("heading", { name: "講師管理" }), ...tutorNames.map(tutorRow)],
    marks: [
      a.getByRole("button", { name: "講師を招待" }),
      tutorNames.map((n) => tutorRow(n).locator("div.grid > div").nth(2).locator("span, div").first()),
      tutorRow(Y).getByRole("button", { name: "編集" }),
    ],
    numbered: true,
    markPad: 3,
    pad: 14,
  });
  await a.getByRole("button", { name: "講師を招待" }).click();
  await a.locator("#inv-name").fill("小林 真央");
  await a.locator("#inv-email").fill("kobayashi@example.com");
  const invite = a.locator("div.rounded-lg.border").filter({ has: a.locator("#inv-name") });
  await snap(a, "admin/tutor-invite", {
    clip: [a.getByRole("button", { name: "講師を招待" }), invite],
    marks: [a.locator("#inv-name"), a.locator("#inv-email"), a.getByRole("button", { name: "招待を送信" })],
    numbered: true,
    markPad: 3,
    pad: 14,
  });
  await a.getByRole("button", { name: "講師を招待" }).click();
  // 編集: 連携済みの講師 (氏名・パスワード再設定・無効化)
  await tutorRow(Y).getByRole("button", { name: "編集" }).click();
  await settle(a, 400);
  await snap(a, "admin/tutor-edit", {
    clip: tutorRow(Y),
    marks: [
      tutorRow(Y).getByRole("button", { name: "氏名を保存" }),
      tutorRow(Y).getByRole("button", { name: "パスワード再設定メール" }),
      tutorRow(Y).getByRole("button", { name: "無効化" }),
    ],
    numbered: true,
    markPad: 3,
  });
  await tutorRow(Y).getByRole("button", { name: "閉じる" }).first().click();
  // 編集: 招待中の講師 (招待を再送)
  await tutorRow(N).getByRole("button", { name: "編集" }).click();
  await settle(a, 400);
  await snap(a, "admin/tutor-resend", {
    clip: tutorRow(N),
    marks: [tutorRow(N).getByRole("button", { name: "招待を再送" })],
    markPad: 3,
  });
  await tutorRow(N).getByRole("button", { name: "閉じる" }).first().click();
  // 編集: 座席表から入っただけの講師 (メールを入れて招待)
  const unlinked = tutorRow(CAST.nakamura.name);
  await unlinked.getByRole("button", { name: "編集" }).click();
  await settle(a, 400);
  await unlinked.getByLabel("ログイン連携（招待メール送信）").fill("nakamura@example.com");
  await snap(a, "admin/tutor-link", {
    clip: unlinked,
    marks: [unlinked.getByLabel("ログイン連携（招待メール送信）"), unlinked.getByRole("button", { name: "招待を送信" })],
    numbered: true,
    markPad: 3,
  });

  // 担当科目
  await go(a, "/admin/tutor-subjects");
  await snap(a, "admin/tutor-subjects", {
    clip: [sectionNav(a), a.locator("main table").first()],
    marks: [sectionNav(a).getByRole("link", { name: "担当科目" }), a.getByRole("link", { name: `${Y} の担当科目を直す` })],
    numbered: true,
    markPad: 2,
    pad: 14,
  });

  // 教室長
  await go(a, "/admin/admins");
  await snap(a, "admin/admins", {
    clip: [sectionNav(a), a.locator("main div.rounded-lg.border").last()],
    marks: [sectionNav(a).getByRole("link", { name: "教室長" })],
    markPad: 2,
    pad: 14,
  });

  // 講習期間
  await go(a, "/admin/periods");
  const springStart = addDays(WEEK_A, 119);
  await a.locator("#p-name").fill(`${springStart.getUTCFullYear()}年 春期講習`);
  await a.locator("#p-start").fill(iso(springStart));
  await a.locator("#p-end").fill(iso(addDays(springStart, 13)));
  await a.locator("#p-deadline").fill(iso(addDays(springStart, -28)));
  await snap(a, "admin/period-create", {
    clip: cardWith(a, "講習期間と提出締切日を設定します。"),
    marks: [a.locator("#p-name"), [a.locator("#p-start"), a.locator("#p-end")], a.locator("#p-deadline"), a.getByRole("button", { name: "作成", exact: true })],
    numbered: true,
    markPad: 3,
  });
  const periodList = cardWith(a, "期間一覧");
  await snap(a, "admin/period-list", {
    clip: periodList,
    marks: [periodList.getByRole("button", { name: "編集" }).first(), periodList.getByRole("button", { name: "アーカイブ" }).first()],
    numbered: true,
    markPad: 3,
  });

  // レギュラー期間
  await go(a, "/admin/regular-periods");
  const nextStart = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 5, 1));
  const nextEnd = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth() + 3, 0));
  await a.locator("#rp-label").fill(`${nextStart.getUTCFullYear()}年${nextStart.getUTCMonth() + 1}-${nextEnd.getUTCMonth() + 1}月`);
  await a.locator("#rp-start").fill(iso(nextStart));
  await a.locator("#rp-end").fill(iso(nextEnd));
  await a.locator("#rp-opens").fill(iso(addDays(nextStart, -60)));
  await a.locator("#rp-due").fill(iso(addDays(nextStart, -32)));
  await snap(a, "admin/regular-period-create", {
    clip: cardWith(a, "期の長さは可変です。"),
    marks: [
      a.locator("#rp-label"),
      [a.locator("#rp-start"), a.locator("#rp-end")],
      [a.locator("#rp-opens"), a.locator("#rp-due")],
      a.getByRole("button", { name: "作成", exact: true }),
    ],
    numbered: true,
    markPad: 3,
  });

  // シフト希望 (講習)
  await go(a, "/admin/training");
  const periodLink = a.locator("main a[href*='period=']").first();
  await snap(a, "admin/training-list", {
    clip: [sectionNav(a), periodLink],
    marks: [periodLink],
    markPad: 3,
    pad: 14,
  });
  await openAdminTraining(a);
  await snap(a, "admin/training-wish-table", { clip: cardWith(a, "講師ごとの希望（座席表への入力用）"), marks: [a.getByLabel("講師", { exact: true })], markPad: 3 });
  const heat = a.locator("main table").filter({ has: a.locator("button[title*='希望']") }).first();
  const cell = a.locator("button[title*='希望 3 名']").first();
  await snap(a, "admin/training-heatmap", {
    clip: [a.getByText("色が濃いほど"), heat],
    marks: [cell],
    markPad: 2,
    pad: 14,
  });
  await cell.click();
  const panel = a.locator("div.max-w-sm").filter({ hasText: "希望者の前のチェックで確定をトグル" });
  await panel.waitFor({ timeout: 30000 });
  const boxes = panel.locator("input[type='checkbox']");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await snap(a, "admin/training-cell", {
    clip: panel,
    marks: [panel.locator("ul"), panel.getByRole("button", { name: /^保存/ })],
    numbered: true,
    markPad: 3,
    pad: 14,
  });
  await panel.getByRole("button", { name: /^保存/ }).click();
  await a.getByText(/名を確定しました。/).waitFor({ timeout: 30000 });
  await settle(a);
  const notify = a.getByRole("button", { name: "講師に公開を通知" });
  await snap(a, "admin/training-notify", {
    clip: [a.getByText("← 講習期間の一覧へ"), a.getByText(/／ 提出 \d+ \/ \d+ 名/), notify],
    marks: [notify],
    markPad: 3,
    pad: 14,
  });

  // シフト希望 (レギュラー)
  const rStart = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 2, 1));
  await go(a, `/admin/fixed-shifts?month=${iso(rStart)}`);
  await snap(a, "admin/regular-status", {
    clip: [sectionNav(a), cardWith(a, "名分の提出状況です。")],
    marks: [sectionNav(a).getByRole("link", { name: "レギュラー" }), a.locator("#target-month")],
    numbered: true,
    markPad: 3,
    pad: 14,
  });
  const decide = cardWith(a, "① 表の名前を押して");
  const regTable = decide.locator("table").first();
  const pick = (name, n = 0) => regTable.getByRole("button", { name }).nth(n);
  await pick(Y, 0).click();
  await pick(T, 0).click();
  await pick(I, 1).click();
  const decideButton = decide.getByRole("button", { name: "レギュラーに決定する" });
  await snap(a, "admin/regular-decide", {
    clip: [decide.getByText(/^レギュラーを決める/), regTable],
    marks: [pick(Y, 0)],
    markPad: 3,
    pad: 14,
  });
  await snap(a, "admin/regular-decide-save", {
    clip: [decide.getByText("講師ごとのレギュラーの割合"), decide.getByText(/^決定すると、/)],
    marks: [decideButton],
    markPad: 3,
    pad: 14,
  });

  // 送ったお知らせ
  await go(a, "/admin/announcements");
  const sent = a.locator("main div.rounded-xl.border").filter({ hasText: "このお知らせを取り消す" }).first();
  await sent.locator("summary").first().click().catch(() => {});
  await snap(a, "admin/announce-sent", {
    clip: [a.getByRole("heading", { name: "送ったお知らせ" }), sent],
    marks: [sent.getByText(/^確認 \d+\/\d+人/), sent.getByRole("button", { name: "このお知らせを取り消す" })],
    numbered: true,
    markPad: 3,
    pad: 14,
  });

  // 通知
  await go(a, "/admin/notifications");
  const adminItems = a.locator("main ul.space-y-2 > li");
  await snap(a, "admin/notifications", {
    clip: [a.getByRole("heading", { name: "通知", exact: true }), adminItems.nth(3)],
    marks: [cardWith(a, "スマホ通知")],
    markPad: 3,
    pad: 14,
  });
};

async function main() {
  const host = (() => {
    try {
      return new URL(DB_URL).hostname;
    } catch {
      return "";
    }
  })();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("DATABASE_URL が手元の DB (localhost / 127.0.0.1) ではありません。テーブルを空にするので、手元の DB 以外では動かしません。");
  }
  const want = process.argv.slice(2);
  const names = want.length > 0 ? want : Object.keys(PHASES);
  const authStub = await startAuthStub();
  // 日付やファイルを選ぶ欄を、ブラウザの日本語表示 (年/月/日・ファイルを選択) に
  // する。headless 専用の軽いブラウザは英語のままなので、通常の Chromium を使う
  browser = await chromium.launch({
    channel: "chromium",
    args: ["--lang=ja"],
    env: { ...process.env, LANG: "ja_JP.UTF-8", LANGUAGE: "ja", LC_ALL: "ja_JP.UTF-8" },
  });
  try {
    for (const n of names) {
      if (!PHASES[n]) throw new Error(`知らない段階です: ${n} (あるのは ${Object.keys(PHASES).join(", ")})`);
      console.log(`▶ ${n}`);
      await PHASES[n]();
    }
  } catch (e) {
    // 止まった画面を残す (どこで止まったかを見るため)
    for (const [who, page] of Object.entries(pages)) {
      const file = path.join(require("node:os").tmpdir(), `guide-failed-${who}.png`);
      await page.screenshot({ path: file }).catch(() => {});
      const text = await page.locator("main").innerText().catch(() => "");
      console.error(`--- ${who}: ${page.url()} (${file})\n${text.slice(0, 1500)}`);
    }
    throw e;
  } finally {
    saveManifest();
    await browser.close();
    authStub?.close();
  }
  console.log(`画像 ${taken.length} 枚を撮りました。`);
}

module.exports = { PHASES, CAST, WEEK_A, WEEK_B, WEEK_C, WEEK_SPECS, TODAY, as, go, snap, settle, upload, dayOf, label, addDays, iso };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
