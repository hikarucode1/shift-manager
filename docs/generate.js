// シフト管理システム Shift Manager UI仕様書 生成スクリプト
const path = require("path");
const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10" x 5.625"
pres.author = "Shift Manager 開発チーム";
pres.title = "シフト管理システム Shift Manager UI仕様書";

// ─── カラーパレット（Midnight Executive + オレンジアクセント） ───
const C = {
  navy: "1E2761",
  navyDark: "0F1A45",
  navyLight: "3D4E88",
  ice: "E8F0FE",
  cream: "F8FAFC",
  accent: "E8833A",     // CTA・強調
  accentLight: "FDE9D4",
  success: "2C7A5F",
  warn: "C85A54",
  text: "1F2937",
  muted: "64748B",
  line: "D7DEE8",
  white: "FFFFFF",
};

// 日本語フォント
const FONT_H = "Yu Gothic";  // 見出し
const FONT_B = "Yu Gothic";  // 本文

const W = 10;
const H = 5.625;

// ─── ヘッダーバー（各コンテンツスライド共通） ─────────
function addHeader(slide, title, pageNo, total) {
  // 上部のナビバー
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: W, h: 0.55,
    fill: { color: C.navy }, line: { color: C.navy },
  });
  // アクセントライン
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0.55, w: W, h: 0.04,
    fill: { color: C.accent }, line: { color: C.accent },
  });
  slide.addText(title, {
    x: 0.4, y: 0.05, w: 7.5, h: 0.45,
    fontFace: FONT_H, fontSize: 18, bold: true, color: C.white,
    valign: "middle", margin: 0,
  });
  slide.addText(`${pageNo} / ${total}`, {
    x: 8.4, y: 0.05, w: 1.2, h: 0.45,
    fontFace: FONT_B, fontSize: 11, color: C.ice,
    valign: "middle", align: "right", margin: 0,
  });
  // フッター
  slide.addText("Shift Manager  UI仕様書  v0.1", {
    x: 0.4, y: H - 0.35, w: 6, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.muted,
    valign: "middle", margin: 0,
  });
}

// ─── スライド01: 表紙 ───────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  // 左側の縦アクセント
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.35, h: H, fill: { color: C.accent }, line: { color: C.accent },
  });
  // 右上の装飾円
  s.addShape(pres.shapes.OVAL, {
    x: 7.8, y: -1.2, w: 3.5, h: 3.5,
    fill: { color: C.navyLight, transparency: 60 }, line: { color: C.navyLight, transparency: 60 },
  });
  s.addShape(pres.shapes.OVAL, {
    x: 8.6, y: 3.8, w: 2.2, h: 2.2,
    fill: { color: C.accent, transparency: 70 }, line: { color: C.accent, transparency: 70 },
  });

  s.addText("シフト管理システム", {
    x: 0.9, y: 1.4, w: 8, h: 0.6,
    fontFace: FONT_B, fontSize: 20, color: C.ice, margin: 0,
  });
  s.addText("Shift Manager", {
    x: 0.9, y: 1.9, w: 8, h: 1.1,
    fontFace: FONT_H, fontSize: 56, bold: true, color: C.white, margin: 0,
  });
  s.addText("UI 仕様書", {
    x: 0.9, y: 3.0, w: 8, h: 0.6,
    fontFace: FONT_H, fontSize: 26, color: C.accent, margin: 0,
  });

  // 下部情報
  s.addShape(pres.shapes.LINE, {
    x: 0.9, y: 4.4, w: 4, h: 0,
    line: { color: C.accentLight, width: 1 },
  });
  s.addText([
    { text: "対象読者: 教室長・管理者", options: { breakLine: true } },
    { text: "目的:     開発着手前の機能・画面・運用フローのご確認", options: { breakLine: true } },
    { text: "日付:     2026-04-22   バージョン v0.1" },
  ], {
    x: 0.9, y: 4.5, w: 6, h: 0.9,
    fontFace: FONT_B, fontSize: 11, color: C.ice, margin: 0,
  });
}

// ─── スライド02: 目次 ───────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "目次", 2, 18);

  const items = [
    ["01", "このシステムで何ができるか"],
    ["02", "登場人物（ユーザー）"],
    ["03", "シフトの2つの期間"],
    ["04", "運用フロー"],
    ["05", "画面一覧"],
    ["06", "主要画面の詳細"],
    ["07", "スマホ対応 / データの安全性"],
    ["08", "導入スケジュール"],
    ["09", "ご承認いただきたいポイント"],
  ];

  items.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.6 + col * 4.6;
    const y = 1.0 + row * 0.75;

    s.addShape(pres.shapes.RECTANGLE, {
      x: x, y: y, w: 0.08, h: 0.55,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    s.addText(item[0], {
      x: x + 0.2, y: y, w: 0.6, h: 0.55,
      fontFace: FONT_H, fontSize: 20, bold: true, color: C.accent,
      valign: "middle", margin: 0,
    });
    s.addText(item[1], {
      x: x + 0.85, y: y, w: 3.4, h: 0.55,
      fontFace: FONT_B, fontSize: 14, color: C.text,
      valign: "middle", margin: 0,
    });
  });
}

// ─── スライド03: サマリ（3行で言うと） ─────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "01  このシステムで何ができるか", 3, 18);

  s.addText("紙・LINE・Excel に散らばったシフト業務を", {
    x: 0.6, y: 0.9, w: 9, h: 0.4,
    fontFace: FONT_B, fontSize: 14, color: C.muted, margin: 0,
  });
  s.addText("1つの Web サイトで完結", {
    x: 0.6, y: 1.3, w: 9, h: 0.6,
    fontFace: FONT_H, fontSize: 28, bold: true, color: C.navy, margin: 0,
  });

  const cards = [
    { n: "1", t: "講師がスマホから提出", d: "通常期間の固定シフト・講習期間の希望を、スマホで登録" },
    { n: "2", t: "教室長は Excel のまま", d: "いつもの Excel で組んだシフトをアップロードするだけで全員に公開" },
    { n: "3", t: "交代・欠勤もアプリで", d: "申請 → 承認 → シフト差し替えまでアプリ内で完結" },
  ];
  cards.forEach((c, i) => {
    const x = 0.6 + i * 3.05;
    const y = 2.3;
    // カード
    s.addShape(pres.shapes.RECTANGLE, {
      x: x, y: y, w: 2.85, h: 2.65,
      fill: { color: C.white },
      line: { color: C.line, width: 1 },
      shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.06 },
    });
    // 番号バッジ
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.3, y: y + 0.3, w: 0.55, h: 0.55,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    s.addText(c.n, {
      x: x + 0.3, y: y + 0.3, w: 0.55, h: 0.55,
      fontFace: FONT_H, fontSize: 20, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
    // タイトル・本文をバッジ直下に詰める
    s.addText(c.t, {
      x: x + 0.25, y: y + 0.95, w: 2.4, h: 0.5,
      fontFace: FONT_H, fontSize: 15, bold: true, color: C.navy, margin: 0,
    });
    s.addText(c.d, {
      x: x + 0.25, y: y + 1.45, w: 2.4, h: 1.1,
      fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0,
    });
  });
}

// ─── スライド04: Before / After ───────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "01  導入するとこうなる", 4, 18);

  const rows = [
    ["項目", "今（現状）", "導入後"],
    ["希望提出", "LINE・紙", "スマホから登録、締切管理も自動"],
    ["シフト共有", "プリント・LINE画像", "アプリで全員に即公開"],
    ["交代連絡", "LINE グループ", "アプリで申請 → 承認 → 反映まで"],
    ["教室長の Excel 作業", "そのまま", "そのまま（変わらない）"],
  ];
  const tableData = rows.map((r, idx) => {
    if (idx === 0) {
      return r.map(cell => ({
        text: cell,
        options: { fill: { color: C.navy }, color: C.white, bold: true,
                   fontFace: FONT_H, fontSize: 13, align: "center", valign: "middle" },
      }));
    }
    return r.map((cell, ci) => ({
      text: cell,
      options: {
        fill: { color: idx % 2 === 0 ? C.ice : C.white },
        color: ci === 0 ? C.navy : C.text,
        bold: ci === 0,
        fontFace: FONT_B, fontSize: 12,
        align: ci === 0 ? "left" : "left",
        valign: "middle",
      },
    }));
  });

  s.addTable(tableData, {
    x: 0.6, y: 1.0, w: 8.8,
    colW: [2.2, 3.0, 3.6],
    rowH: 0.55,
    border: { pt: 1, color: C.line },
  });

  // 強調メッセージ
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 4.3, w: 8.8, h: 0.75,
    fill: { color: C.accentLight }, line: { color: C.accent, width: 1 },
  });
  s.addText([
    { text: "POINT  ", options: { bold: true, color: C.accent, fontSize: 12 } },
    { text: "教室長さんが Excel でシフトを組む作業は ", options: { color: C.text, fontSize: 12 } },
    { text: "変わりません", options: { bold: true, color: C.warn, fontSize: 12 } },
    { text: "。組んだ Excel を画面にアップロードするだけで反映されます。", options: { color: C.text, fontSize: 12 } },
  ], {
    x: 0.9, y: 4.35, w: 8.3, h: 0.65,
    fontFace: FONT_B, valign: "middle", margin: 0,
  });
}

// ─── スライド05: 登場人物 ─────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "02  登場人物（ユーザー）", 5, 18);

  s.addText("本システムには2種類のユーザーがいます", {
    x: 0.6, y: 0.85, w: 9, h: 0.4,
    fontFace: FONT_B, fontSize: 13, color: C.muted, margin: 0,
  });

  const users = [
    {
      role: "講師",
      sub: "（アルバイト）",
      color: C.navy,
      accent: C.ice,
      emoji: "T",
      can: [
        "自分の固定シフト（曜日×コマ）を登録",
        "講習期間の希望をスマホから提出",
        "確定されたシフトを閲覧",
        "欠勤・交代・代講を申請",
      ],
    },
    {
      role: "教室長",
      sub: "（管理者）",
      color: C.accent,
      accent: C.accentLight,
      emoji: "A",
      can: [
        "講師の登録・招待・管理",
        "通常期間・講習期間と締切の設定",
        "希望の俯瞰（ヒートマップ）",
        "Excel をアップロードして週次シフトを確定",
        "欠勤・交代申請の承認",
      ],
    },
  ];

  users.forEach((u, i) => {
    const x = 0.6 + i * 4.5;
    const y = 1.4;
    s.addShape(pres.shapes.RECTANGLE, {
      x: x, y: y, w: 4.2, h: 3.6,
      fill: { color: C.white }, line: { color: C.line, width: 1 },
      shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.08 },
    });
    // サイドアクセント
    s.addShape(pres.shapes.RECTANGLE, {
      x: x, y: y, w: 0.12, h: 3.6,
      fill: { color: u.color }, line: { color: u.color },
    });
    // ロールバッジ
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.4, y: y + 0.35, w: 0.8, h: 0.8,
      fill: { color: u.color }, line: { color: u.color },
    });
    s.addText(u.emoji, {
      x: x + 0.4, y: y + 0.35, w: 0.8, h: 0.8,
      fontFace: FONT_H, fontSize: 28, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(u.role, {
      x: x + 1.35, y: y + 0.35, w: 2.7, h: 0.45,
      fontFace: FONT_H, fontSize: 22, bold: true, color: u.color, margin: 0,
    });
    s.addText(u.sub, {
      x: x + 1.35, y: y + 0.8, w: 2.7, h: 0.3,
      fontFace: FONT_B, fontSize: 11, color: C.muted, margin: 0,
    });
    // できること
    s.addText("できること", {
      x: x + 0.4, y: y + 1.35, w: 3.5, h: 0.3,
      fontFace: FONT_H, fontSize: 11, bold: true, color: C.muted,
      charSpacing: 2, margin: 0,
    });
    s.addText(
      u.can.map((t, idx) => ({ text: t, options: { bullet: true, breakLine: idx < u.can.length - 1 } })),
      {
        x: x + 0.4, y: y + 1.7, w: 3.6, h: 1.8,
        fontFace: FONT_B, fontSize: 11, color: C.text,
        paraSpaceAfter: 3, margin: 0,
      }
    );
  });
}

// ─── スライド06: シフトの2つの期間 ──────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "03  シフトの2つの期間", 6, 18);

  s.addText("本システムは期間を「通常」と「講習」で分けて扱います", {
    x: 0.6, y: 0.85, w: 9, h: 0.4,
    fontFace: FONT_B, fontSize: 13, color: C.muted, margin: 0,
  });

  const periods = [
    {
      title: "通常期間", sub: "平常営業の時期",
      color: C.navy, bg: C.ice,
      rows: [
        ["提出方法", "曜日×コマで固定シフトを登録"],
        ["例", "月曜18-21時、水曜18-21時 ..."],
        ["適用", "毎週自動で適用"],
        ["変更", "欠勤申請で日付指定の欠勤可能"],
      ],
    },
    {
      title: "講習期間", sub: "春期・夏期・冬期 等",
      color: C.accent, bg: C.accentLight,
      rows: [
        ["設定", "教室長が期間名・締切日を登録"],
        ["例", "2026夏期講習 7/21〜8/31 締切7/10"],
        ["提出方法", "締切までに日ごとに希望コマを登録"],
        ["締切後", "読み取り専用（教室長が再開放可能）"],
      ],
    },
  ];

  periods.forEach((p, i) => {
    const x = 0.6 + i * 4.5;
    const y = 1.4;
    s.addShape(pres.shapes.RECTANGLE, {
      x: x, y: y, w: 4.2, h: 3.75,
      fill: { color: C.white }, line: { color: C.line, width: 1 },
      shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.08 },
    });
    // タイトル帯
    s.addShape(pres.shapes.RECTANGLE, {
      x: x, y: y, w: 4.2, h: 0.75,
      fill: { color: p.color }, line: { color: p.color },
    });
    s.addText(p.title, {
      x: x + 0.3, y: y + 0.05, w: 3.8, h: 0.45,
      fontFace: FONT_H, fontSize: 20, bold: true, color: C.white, margin: 0,
    });
    s.addText(p.sub, {
      x: x + 0.3, y: y + 0.47, w: 3.8, h: 0.25,
      fontFace: FONT_B, fontSize: 10, color: C.white, margin: 0,
    });
    // テーブル
    p.rows.forEach((r, ri) => {
      const ry = y + 0.95 + ri * 0.67;
      s.addShape(pres.shapes.RECTANGLE, {
        x: x + 0.2, y: ry, w: 1.1, h: 0.55,
        fill: { color: p.bg }, line: { color: p.bg },
      });
      s.addText(r[0], {
        x: x + 0.2, y: ry, w: 1.1, h: 0.55,
        fontFace: FONT_H, fontSize: 10, bold: true, color: p.color,
        align: "center", valign: "middle", margin: 0,
      });
      s.addText(r[1], {
        x: x + 1.4, y: ry, w: 2.7, h: 0.55,
        fontFace: FONT_B, fontSize: 11, color: C.text,
        valign: "middle", margin: 0,
      });
    });
  });
}

// ─── スライド07: 運用フロー：通常期間 ──────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "04  運用フロー：通常期間", 7, 18);

  // アクター列のヘッダー
  const actors = [
    { x: 0.6, label: "講師", color: C.navy },
    { x: 4.4, label: "教室長", color: C.accent },
    { x: 8.2, label: "システム", color: C.muted },
  ];
  actors.forEach(a => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: a.x, y: 0.95, w: 1.4, h: 0.5,
      fill: { color: a.color }, line: { color: a.color },
    });
    s.addText(a.label, {
      x: a.x, y: 0.95, w: 1.4, h: 0.5,
      fontFace: FONT_H, fontSize: 13, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
  });
  // 縦の破線
  actors.forEach(a => {
    s.addShape(pres.shapes.LINE, {
      x: a.x + 0.7, y: 1.45, w: 0, h: 3.7,
      line: { color: C.line, width: 1, dashType: "dash" },
    });
  });

  // ステップ
  const steps = [
    { y: 1.7, from: 0, to: 1, label: "① 固定シフトを登録" },
    { y: 2.2, from: 1, to: 1, label: "② Excel でシフト作成" },
    { y: 2.7, from: 1, to: 2, label: "③ Excel をアップロード" },
    { y: 3.2, from: 2, to: 0, label: "④ 確定シフトを全員に公開" },
    { y: 3.7, from: 0, to: 1, label: "⑤ 欠勤申請（必要時）" },
    { y: 4.2, from: 1, to: 2, label: "⑥ 承認 → シフト差し替え" },
  ];

  steps.forEach((st) => {
    const fromX = actors[st.from].x + 0.7;
    const toX = actors[st.to].x + 0.7;
    if (st.from === st.to) {
      // 自己ループ: 小さな四角で表現
      s.addShape(pres.shapes.RECTANGLE, {
        x: fromX - 0.1, y: st.y + 0.1, w: 0.2, h: 0.1,
        fill: { color: C.accent }, line: { color: C.accent },
      });
    } else {
      const left = Math.min(fromX, toX);
      const w = Math.abs(toX - fromX);
      s.addShape(pres.shapes.LINE, {
        x: left, y: st.y + 0.15, w: w, h: 0,
        line: { color: C.accent, width: 2, endArrowType: "triangle" },
      });
      // 始点側の小さな丸
      s.addShape(pres.shapes.OVAL, {
        x: fromX - 0.06, y: st.y + 0.09, w: 0.12, h: 0.12,
        fill: { color: C.accent }, line: { color: C.accent },
      });
    }
    // ラベル（矢印の上）
    const labelX = st.from === st.to ? actors[st.from].x - 0.1 : Math.min(fromX, toX);
    const labelW = st.from === st.to ? 2.5 : Math.abs(toX - fromX);
    s.addText(st.label, {
      x: labelX, y: st.y - 0.2, w: labelW, h: 0.3,
      fontFace: FONT_B, fontSize: 11, color: C.text,
      align: "center", valign: "middle", margin: 0,
    });
  });
}

// ─── スライド08: 運用フロー：講習期間 ──────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "04  運用フロー：講習期間", 8, 18);

  // スライド07とアクター列順序を揃える（講師・教室長・システム）
  const actors = [
    { x: 0.6, label: "講師",   color: C.navy },
    { x: 4.4, label: "教室長", color: C.accent },
    { x: 8.2, label: "システム", color: C.muted },
  ];
  actors.forEach(a => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: a.x, y: 0.95, w: 1.4, h: 0.5,
      fill: { color: a.color }, line: { color: a.color },
    });
    s.addText(a.label, {
      x: a.x, y: 0.95, w: 1.4, h: 0.5,
      fontFace: FONT_H, fontSize: 13, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
  });
  actors.forEach(a => {
    s.addShape(pres.shapes.LINE, {
      x: a.x + 0.7, y: 1.45, w: 0, h: 3.4,
      line: { color: C.line, width: 1, dashType: "dash" },
    });
  });

  // actors: [0]=講師, [1]=教室長, [2]=システム
  const steps = [
    { y: 1.7, from: 1, to: 2, label: "① 教室長が講習期間と締切日を登録" },
    { y: 2.3, from: 0, to: 2, label: "② 講師が日ごとに希望を提出" },
    { y: 2.9, from: 2, to: 1, label: "③ 希望一覧を教室長が確認" },
    { y: 3.5, from: 1, to: 2, label: "④ Excel でシフト作成 → アップロード" },
    { y: 4.1, from: 2, to: 0, label: "⑤ 確定シフトを講師に公開" },
  ];

  steps.forEach((st) => {
    const fromX = actors[st.from].x + 0.7;
    const toX = actors[st.to].x + 0.7;
    const left = Math.min(fromX, toX);
    const w = Math.abs(toX - fromX);
    s.addShape(pres.shapes.LINE, {
      x: left, y: st.y + 0.15, w: w, h: 0,
      line: { color: C.accent, width: 2, endArrowType: "triangle" },
    });
    s.addShape(pres.shapes.OVAL, {
      x: fromX - 0.06, y: st.y + 0.09, w: 0.12, h: 0.12,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    s.addText(st.label, {
      x: left, y: st.y - 0.2, w: w, h: 0.3,
      fontFace: FONT_B, fontSize: 11, color: C.text,
      align: "center", valign: "middle", margin: 0,
    });
  });

  // 補足
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 4.75, w: 8.8, h: 0.5,
    fill: { color: C.ice }, line: { color: C.navy, width: 1 },
  });
  s.addText([
    { text: "ヒント  ", options: { bold: true, color: C.navy } },
    { text: "講習期間は「春期」「夏期」等を何回でも登録可能。それぞれ別の締切日を設定できます。", options: { color: C.text } },
  ], {
    x: 0.8, y: 4.78, w: 8.5, h: 0.45,
    fontFace: FONT_B, fontSize: 11, valign: "middle", margin: 0,
  });
}

// ─── スライド09: 画面一覧（講師用） ────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "05  画面一覧：講師用（スマホ・PC 共通）", 9, 18);

  const rows = [
    ["No", "画面名", "やること"],
    ["T-1", "ログイン", "メールアドレスとパスワードでログイン"],
    ["T-2", "ホーム", "今週のシフトと未読申請の確認"],
    ["T-3", "固定シフト登録", "曜日×コマで通常期間の勤務可能枠を登録"],
    ["T-4", "欠勤申請", "日付を選んで欠勤を申請"],
    ["T-5", "講習希望提出", "講習期間ごとに日別で希望を登録"],
    ["T-6", "交代申請", "確定シフトに対し交代・代講を申請"],
    ["T-7", "代講募集一覧", "他講師の代講募集に応募"],
  ];
  const tableData = rows.map((r, idx) => {
    if (idx === 0) {
      return r.map(cell => ({
        text: cell,
        options: { fill: { color: C.navy }, color: C.white, bold: true,
                   fontFace: FONT_H, fontSize: 12, align: "center", valign: "middle" },
      }));
    }
    return [
      { text: r[0], options: { fill: { color: C.ice }, color: C.navy, bold: true,
                               fontFace: FONT_H, fontSize: 11, align: "center", valign: "middle" } },
      { text: r[1], options: { fill: { color: C.white }, color: C.text, bold: true,
                               fontFace: FONT_B, fontSize: 12, valign: "middle" } },
      { text: r[2], options: { fill: { color: C.white }, color: C.text,
                               fontFace: FONT_B, fontSize: 11, valign: "middle" } },
    ];
  });
  s.addTable(tableData, {
    x: 0.6, y: 1.0, w: 8.8,
    colW: [0.9, 2.6, 5.3],
    rowH: 0.47,
    border: { pt: 1, color: C.line },
  });
}

// ─── スライド10: 画面一覧（教室長用） ──────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "05  画面一覧：教室長用", 10, 18);

  const rows = [
    ["No", "画面名", "やること"],
    ["A-1", "ログイン", "同上"],
    ["A-2", "ダッシュボード", "今週の稼働状況・未対応申請"],
    ["A-3", "講師管理", "講師の招待・有効/無効化"],
    ["A-4", "期間管理", "通常/講習期間と締切日を設定"],
    ["A-5", "固定シフト俯瞰", "全講師の固定枠を一覧"],
    ["A-6", "講習希望俯瞰", "全講師の希望をカレンダー/ヒートマップ表示"],
    ["A-7", "Excel アップロード", "⭐ 確定シフトの Excel を取り込み（中核機能）"],
    ["A-8", "週次シフト表", "確定済みシフトを一覧・印刷"],
    ["A-9", "申請承認", "欠勤・交代申請を承認/却下"],
  ];
  const tableData = rows.map((r, idx) => {
    if (idx === 0) {
      return r.map(cell => ({
        text: cell,
        options: { fill: { color: C.accent }, color: C.white, bold: true,
                   fontFace: FONT_H, fontSize: 12, align: "center", valign: "middle" },
      }));
    }
    const isCore = r[0] === "A-7";
    return [
      { text: r[0], options: { fill: { color: isCore ? C.accentLight : C.ice },
                               color: isCore ? C.accent : C.navy, bold: true,
                               fontFace: FONT_H, fontSize: 11, align: "center", valign: "middle" } },
      { text: r[1], options: { fill: { color: isCore ? C.accentLight : C.white },
                               color: C.text, bold: true,
                               fontFace: FONT_B, fontSize: 12, valign: "middle" } },
      { text: r[2], options: { fill: { color: isCore ? C.accentLight : C.white },
                               color: C.text, bold: isCore,
                               fontFace: FONT_B, fontSize: 11, valign: "middle" } },
    ];
  });
  s.addTable(tableData, {
    x: 0.6, y: 1.0, w: 8.8,
    colW: [0.9, 2.6, 5.3],
    rowH: 0.42,
    border: { pt: 1, color: C.line },
  });
}

// ── 画面モックアップ用ユーティリティ ──
function addMockup(s, x, y, w, h, title, content, opts = {}) {
  const titleH = 0.4;
  // 枠
  s.addShape(pres.shapes.RECTANGLE, {
    x: x, y: y, w: w, h: h,
    fill: { color: C.white }, line: { color: C.navy, width: 1.5 },
    shadow: { type: "outer", color: "000000", blur: 10, offset: 3, angle: 90, opacity: 0.1 },
  });
  // タイトルバー
  s.addShape(pres.shapes.RECTANGLE, {
    x: x, y: y, w: w, h: titleH,
    fill: { color: C.navy }, line: { color: C.navy },
  });
  s.addText(title, {
    x: x + 0.15, y: y, w: w - 0.3, h: titleH,
    fontFace: FONT_H, fontSize: 11, bold: true, color: C.white,
    valign: "middle", margin: 0,
  });
  // コンテンツ
  s.addText(content, {
    x: x + 0.2, y: y + titleH + 0.1, w: w - 0.4, h: h - titleH - 0.2,
    fontFace: opts.mono ? "Consolas" : FONT_B,
    fontSize: opts.fontSize || 10, color: C.text,
    valign: "top", margin: 0,
  });
}

// ─── スライド11: T-3 固定シフト登録 ────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "06  T-3 固定シフト登録（講師）", 11, 18);

  s.addText("通常期間の毎週の勤務可能枠を、曜日×コマで設定", {
    x: 0.6, y: 0.85, w: 9, h: 0.35,
    fontFace: FONT_B, fontSize: 13, color: C.muted, margin: 0,
  });

  // モックアップ
  addMockup(s, 0.6, 1.35, 5.2, 3.7, "固定シフト登録", [
    { text: "通常期間の毎週の勤務可能枠を設定します。", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "           月    火    水    木    金    土    日", options: { breakLine: true, bold: true } },
    { text: "    1限   ☐    ☐    ☐    ☐    ☐    ☐    ☐", options: { breakLine: true } },
    { text: "    2限   ☐    ☐    ☐    ☐    ☐    ☐    ☐", options: { breakLine: true } },
    { text: "    3限   ☑    ☐    ☑    ☐    ☑    ☐    ☐", options: { breakLine: true, color: C.accent, bold: true } },
    { text: "    4限   ☑    ☐    ☑    ☐    ☑    ☐    ☐", options: { breakLine: true, color: C.accent, bold: true } },
    { text: "    5限   ☑    ☐    ☑    ☐    ☑    ☐    ☐", options: { breakLine: true, color: C.accent, bold: true } },
    { text: "    6限   ☐    ☐    ☐    ☐    ☐    ☐    ☐", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "    適用開始日 : 2026/05/01                [ 保存 ]", options: {} },
  ], { mono: true, fontSize: 10 });

  // 右側：操作説明
  const opsX = 6.1, opsY = 1.35;
  s.addText("操作のポイント", {
    x: opsX, y: opsY, w: 3.3, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: C.navy, margin: 0,
  });
  s.addShape(pres.shapes.LINE, {
    x: opsX, y: opsY + 0.4, w: 1.2, h: 0,
    line: { color: C.accent, width: 2 },
  });
  s.addText([
    { text: "マス目をタップで ON/OFF", options: { bullet: true, breakLine: true } },
    { text: "「保存」を押すと次週から自動適用", options: { bullet: true, breakLine: true } },
    { text: "いつでも再設定可能", options: { bullet: true, breakLine: true } },
    { text: "適用開始日を指定して予約的に変更もできる", options: { bullet: true } },
  ], {
    x: opsX, y: opsY + 0.55, w: 3.3, h: 3,
    fontFace: FONT_B, fontSize: 12, color: C.text,
    paraSpaceAfter: 6, margin: 0,
  });
}

// ─── スライド12: T-5 講習希望提出 ──────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "06  T-5 講習希望提出（講師）", 12, 18);

  s.addText("講習期間の各日について、希望コマを選んで提出", {
    x: 0.6, y: 0.85, w: 9, h: 0.35,
    fontFace: FONT_B, fontSize: 13, color: C.muted, margin: 0,
  });

  addMockup(s, 0.6, 1.35, 5.2, 3.75, "2026年 夏期講習 希望提出", [
    { text: "期間: 7/21〜8/31   締切: 7/10（あと12日）", options: { breakLine: true, color: C.warn, bold: true } },
    { text: "", options: { breakLine: true } },
    { text: "   [ < 7月 ]   7月   [ 8月 > ]", options: { breakLine: true, bold: true } },
    { text: "", options: { breakLine: true } },
    { text: "        月21  火22  水23  木24  金25  土26", options: { breakLine: true, bold: true } },
    { text: "   1限   ☐    ☐    ☐    ☐    ☐    ☐", options: { breakLine: true } },
    { text: "   2限   ☑    ☑    ☐    ☑    ☑    ☐", options: { breakLine: true, color: C.accent, bold: true } },
    { text: "   3限   ☑    ☑    ☐    ☑    ☑    ☐", options: { breakLine: true, color: C.accent, bold: true } },
    { text: "   4限   ☑    ☑    ☐    ☑    ☑    ☐", options: { breakLine: true, color: C.accent, bold: true } },
    { text: "   5限   ☐    ☐    ☐    ☐    ☐    ☐", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "   備考:  [                              ]", options: { breakLine: true } },
    { text: "                         [ 一時保存 ][ 提出 ]", options: {} },
  ], { mono: true, fontSize: 10 });

  const opsX = 6.1, opsY = 1.35;
  s.addText("操作のポイント", {
    x: opsX, y: opsY, w: 3.3, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: C.navy, margin: 0,
  });
  s.addShape(pres.shapes.LINE, {
    x: opsX, y: opsY + 0.4, w: 1.2, h: 0,
    line: { color: C.accent, width: 2 },
  });
  s.addText([
    { text: "講習期間の日付が一覧表示", options: { bullet: true, breakLine: true } },
    { text: "希望コマをタップして選択", options: { bullet: true, breakLine: true } },
    { text: "締切日まで何度でも修正可能", options: { bullet: true, breakLine: true } },
    { text: "締切後は読み取り専用", options: { bullet: true, breakLine: true } },
    { text: "教室長が締切延長（再開放）可能", options: { bullet: true } },
  ], {
    x: opsX, y: opsY + 0.55, w: 3.3, h: 3,
    fontFace: FONT_B, fontSize: 12, color: C.text,
    paraSpaceAfter: 6, margin: 0,
  });
}

// ─── スライド13: A-7 Excel アップロード（中核） ─────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "06  A-7 Excel アップロード（教室長）  ★ 中核機能", 13, 18);

  // 上部バナー
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 0.85, w: 8.8, h: 0.5,
    fill: { color: C.accentLight }, line: { color: C.accent, width: 1 },
  });
  s.addText([
    { text: "★ 重要  ", options: { bold: true, color: C.accent } },
    { text: "いつもの Excel で組んだシフトをアップロードするだけで、講師全員に公開できます", options: { color: C.text } },
  ], {
    x: 0.8, y: 0.88, w: 8.6, h: 0.45,
    fontFace: FONT_B, fontSize: 12, valign: "middle", margin: 0,
  });

  // モックアップ（サンプルデータを載せて具体性を持たせる）
  addMockup(s, 0.6, 1.5, 5.4, 3.6, "週次シフト確定", [
    { text: "対象週: [ 2026/07/06 〜 07/12 ]", options: { breakLine: true, bold: true } },
    { text: "", options: { breakLine: true } },
    { text: "[ ファイルを選択 ] shift_0706.xlsx    [ アップロード ]", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "─── 読み取り結果プレビュー ──────────", options: { breakLine: true, color: C.muted } },
    { text: "", options: { breakLine: true } },
    { text: "       月6  火7  水8  木9  金10", options: { breakLine: true, bold: true } },
    { text: " 3限  田中  佐藤  田中  佐藤  田中", options: { breakLine: true } },
    { text: " 4限  山本  佐藤  山本  佐藤  山本", options: { breakLine: true } },
    { text: " 5限  山本  鈴木  山本  鈴木  山本", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "⚠ 警告: 1件の講師名が一致しません", options: { breakLine: true, color: C.warn, bold: true } },
    { text: "  「田中」→ 田中太郎 で合ってますか？", options: { breakLine: true, color: C.warn } },
    { text: "       [ はい ]  [ 別の人を選ぶ ]", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "           [ キャンセル ]  [ 確定公開 ]", options: {} },
  ], { mono: true, fontSize: 9 });

  // 右側：手順
  const opsX = 6.3, opsY = 1.5;
  s.addText("アップロード手順", {
    x: opsX, y: opsY, w: 3.3, h: 0.4,
    fontFace: FONT_H, fontSize: 14, bold: true, color: C.accent, margin: 0,
  });
  const steps = [
    "対象週を選択",
    "Excel ファイルを選択",
    "システムが自動で読み取り",
    "プレビューで内容確認",
    "警告があれば画面上で修正",
    "「確定公開」で全員に公開",
  ];
  steps.forEach((t, i) => {
    const y = opsY + 0.55 + i * 0.45;
    s.addShape(pres.shapes.OVAL, {
      x: opsX, y: y, w: 0.3, h: 0.3,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    s.addText(String(i + 1), {
      x: opsX, y: y, w: 0.3, h: 0.3,
      fontFace: FONT_H, fontSize: 11, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(t, {
      x: opsX + 0.4, y: y, w: 3.0, h: 0.3,
      fontFace: FONT_B, fontSize: 11, color: C.text,
      valign: "middle", margin: 0,
    });
  });
}

// ─── スライド14: A-6 講習希望俯瞰 ──────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "06  A-6 講習希望俯瞰（教室長）", 14, 18);

  s.addText("全講師の希望を、色の濃淡で一目で把握できるヒートマップ", {
    x: 0.6, y: 0.85, w: 9, h: 0.35,
    fontFace: FONT_B, fontSize: 13, color: C.muted, margin: 0,
  });

  // モックアップ枠
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 1.35, w: 5.6, h: 3.7,
    fill: { color: C.white }, line: { color: C.navy, width: 1.5 },
    shadow: { type: "outer", color: "000000", blur: 10, offset: 3, angle: 90, opacity: 0.1 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 1.35, w: 5.6, h: 0.4,
    fill: { color: C.navy }, line: { color: C.navy },
  });
  s.addText("夏期講習 希望一覧", {
    x: 0.75, y: 1.35, w: 5.4, h: 0.4,
    fontFace: FONT_H, fontSize: 11, bold: true, color: C.white,
    valign: "middle", margin: 0,
  });

  // 見出し
  s.addText("期間: 7/21〜8/31    提出状況: 8 / 10 講師", {
    x: 0.8, y: 1.85, w: 5.3, h: 0.3,
    fontFace: FONT_B, fontSize: 10, color: C.muted, margin: 0,
  });

  // ヒートマップ
  const days = ["月21", "火22", "水23", "木24", "金25", "土26"];
  const slots = ["1限", "2限", "3限", "4限", "5限"];
  // 濃度: 0=空, 1=薄, 2=中, 3=濃
  const grid = [
    [0, 3, 0, 3, 3, 1],
    [2, 3, 0, 3, 3, 0],
    [3, 3, 2, 3, 3, 1],
    [3, 3, 2, 3, 3, 0],
    [2, 0, 0, 3, 2, 0],
  ];
  // 0=空, 1=薄, 2=中, 3=濃。最薄色は背景に埋もれないよう明度を下げる
  const colors = ["FDECD9", "F9C591", "F19F4A", C.accent];
  const cellW = 0.62, cellH = 0.36;
  const baseX = 1.3, baseY = 2.3;

  // 曜日ヘッダ
  days.forEach((d, di) => {
    s.addText(d, {
      x: baseX + di * cellW, y: baseY - 0.3, w: cellW, h: 0.25,
      fontFace: FONT_B, fontSize: 9, color: C.muted,
      align: "center", valign: "middle", margin: 0,
    });
  });
  slots.forEach((sl, si) => {
    s.addText(sl, {
      x: baseX - 0.65, y: baseY + si * cellH, w: 0.55, h: cellH,
      fontFace: FONT_B, fontSize: 10, bold: true, color: C.navy,
      align: "right", valign: "middle", margin: 0,
    });
    grid[si].forEach((v, di) => {
      s.addShape(pres.shapes.RECTANGLE, {
        x: baseX + di * cellW, y: baseY + si * cellH,
        w: cellW - 0.06, h: cellH - 0.06,
        fill: { color: colors[v] }, line: { color: C.line, width: 0.5 },
      });
    });
  });

  // 凡例
  const legendY = baseY + slots.length * cellH + 0.35;
  s.addText("色が濃いほど希望者多い", {
    x: 0.8, y: legendY, w: 2.4, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.muted, margin: 0,
  });
  ["0-1名", "2名", "3名", "4名以上"].forEach((l, i) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: 3.2 + i * 0.75, y: legendY, w: 0.25, h: 0.22,
      fill: { color: colors[i] }, line: { color: C.line, width: 0.5 },
    });
    s.addText(l, {
      x: 3.45 + i * 0.75, y: legendY - 0.02, w: 0.55, h: 0.26,
      fontFace: FONT_B, fontSize: 8, color: C.text, valign: "middle", margin: 0,
    });
  });

  // 右側：説明
  const opsX = 6.5;
  s.addText("見方・使い方", {
    x: opsX, y: 1.35, w: 3.0, h: 0.4,
    fontFace: FONT_H, fontSize: 15, bold: true, color: C.navy, margin: 0,
  });
  s.addShape(pres.shapes.LINE, {
    x: opsX, y: 1.75, w: 1.2, h: 0,
    line: { color: C.accent, width: 2 },
  });
  s.addText([
    { text: "縦が コマ、横が 日付", options: { bullet: true, breakLine: true } },
    { text: "色の濃淡で希望者数を表現", options: { bullet: true, breakLine: true } },
    { text: "セルをタップでその日時の希望者一覧を表示", options: { bullet: true, breakLine: true } },
    { text: "提出状況（n/m）で締切までの進捗を確認", options: { bullet: true } },
  ], {
    x: opsX, y: 1.9, w: 3.2, h: 3,
    fontFace: FONT_B, fontSize: 11, color: C.text,
    paraSpaceAfter: 6, margin: 0,
  });
}

// ─── スライド15: 交代申請・承認 ────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "06  T-6 / A-9 交代・代講申請と承認", 15, 18);

  s.addText("急な欠勤・代講もアプリ内で完結", {
    x: 0.6, y: 0.85, w: 9, h: 0.35,
    fontFace: FONT_B, fontSize: 13, color: C.muted, margin: 0,
  });

  // 左：講師側モックアップ
  addMockup(s, 0.6, 1.35, 4.2, 3.7, "【講師】交代申請", [
    { text: "対象: 7/10(水) 3限", options: { breakLine: true, bold: true } },
    { text: "", options: { breakLine: true } },
    { text: "交代相手:", options: { breakLine: true } },
    { text: "  ( ) 代講を募集", options: { breakLine: true } },
    { text: "  (●) 指名する", options: { breakLine: true, color: C.accent, bold: true } },
    { text: "      [ 山本太郎  ▼ ]", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "理由:", options: { breakLine: true } },
    { text: "  [ 体調不良のため            ]", options: { breakLine: true } },
    { text: "", options: { breakLine: true } },
    { text: "                      [ 申請 ]", options: {} },
  ], { mono: true, fontSize: 10 });

  // 右：教室長側モックアップ
  addMockup(s, 5.2, 1.35, 4.2, 3.7, "【教室長】承認待ち申請 (3件)", [
    { text: "① 田中 → 山本", options: { breakLine: true, bold: true } },
    { text: "  7/10(水) 3限 / 理由: 体調不良", options: { breakLine: true } },
    { text: "         [ 承認 ] [ 却下 ]", options: { breakLine: true, color: C.accent } },
    { text: "", options: { breakLine: true } },
    { text: "② 鈴木 → 代講募集", options: { breakLine: true, bold: true } },
    { text: "  7/12(金) 4限", options: { breakLine: true } },
    { text: "  応募: 高橋, 佐藤", options: { breakLine: true, color: C.muted } },
    { text: "       [ 高橋を承認 ]", options: { breakLine: true, color: C.accent } },
    { text: "       [ 佐藤を承認 ]", options: { breakLine: true, color: C.accent } },
    { text: "       [ 却下 ]", options: {} },
  ], { mono: true, fontSize: 10 });
}

// ─── スライド16: スマホ対応 & 安全性 ───────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "07  スマホ対応 / データの安全性", 16, 18);

  // 左カード: スマホ対応（ヘッダーは右カードと同じ処理で統一感を出す）
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 0.95, w: 4.3, h: 4.1,
    fill: { color: C.white }, line: { color: C.line, width: 1 },
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.06 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 0.95, w: 4.3, h: 0.55,
    fill: { color: C.navy }, line: { color: C.navy },
  });
  s.addText("スマホ対応", {
    x: 0.8, y: 0.95, w: 4.0, h: 0.55,
    fontFace: FONT_H, fontSize: 17, bold: true, color: C.white,
    valign: "middle", margin: 0,
  });

  // スマホ枠
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 1.1, y: 1.75, w: 1.6, h: 3.0,
    fill: { color: C.navyDark }, line: { color: C.navyDark, width: 2 },
    rectRadius: 0.15,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 1.2, y: 1.95, w: 1.4, h: 2.6,
    fill: { color: C.white }, line: { color: C.white },
  });
  s.addText([
    { text: "≡  固定シフト", options: { breakLine: true, bold: true, color: C.navy } },
    { text: "", options: { breakLine: true } },
    { text: "月 火 水", options: { breakLine: true, bold: true, fontSize: 9 } },
    { text: "1 ☐ ☐ ☐", options: { breakLine: true, fontSize: 9 } },
    { text: "2 ☐ ☐ ☐", options: { breakLine: true, fontSize: 9 } },
    { text: "3 ☑ ☐ ☑", options: { breakLine: true, color: C.accent, fontSize: 9 } },
    { text: "4 ☑ ☐ ☑", options: { breakLine: true, color: C.accent, fontSize: 9 } },
    { text: "", options: { breakLine: true } },
    { text: "[← 金土日→]", options: { breakLine: true, fontSize: 9 } },
    { text: "", options: { breakLine: true } },
    { text: " [ 保存 ]", options: { fontSize: 9, color: C.accent } },
  ], {
    x: 1.25, y: 2.0, w: 1.3, h: 2.5,
    fontFace: "Consolas", fontSize: 10, color: C.text,
    valign: "top", margin: 0,
  });

  s.addText([
    { text: "全画面レスポンシブ対応", options: { bullet: true, breakLine: true } },
    { text: "移動中・休憩中の利用を想定", options: { bullet: true, breakLine: true } },
    { text: "タップ操作に最適化", options: { bullet: true } },
  ], {
    x: 2.9, y: 2.0, w: 1.9, h: 2.8,
    fontFace: FONT_B, fontSize: 11, color: C.text,
    paraSpaceAfter: 6, margin: 0,
  });

  // 右カード: 安全性
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 0.95, w: 4.3, h: 4.1,
    fill: { color: C.white }, line: { color: C.line, width: 1 },
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.06 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 0.95, w: 4.3, h: 0.55,
    fill: { color: C.accent }, line: { color: C.accent },
  });
  s.addText("データの安全性", {
    x: 5.3, y: 0.95, w: 4.0, h: 0.55,
    fontFace: FONT_H, fontSize: 17, bold: true, color: C.white,
    valign: "middle", margin: 0,
  });

  const safety = [
    ["ログイン必須", "関係者以外アクセス不可"],
    ["役割で閲覧制限", "講師は自分のデータ+確定シフトのみ"],
    ["過去データ保持", "履歴は削除せず保存、給与確認に利用可"],
    ["アップロード履歴", "誰がいつどのExcelを上げたか追跡可能"],
  ];
  safety.forEach((r, i) => {
    const y = 1.75 + i * 0.72;
    s.addShape(pres.shapes.OVAL, {
      x: 5.3, y: y, w: 0.35, h: 0.35,
      fill: { color: C.accentLight }, line: { color: C.accent, width: 1 },
    });
    s.addText("✓", {
      x: 5.3, y: y, w: 0.35, h: 0.35,
      fontFace: FONT_H, fontSize: 14, bold: true, color: C.accent,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(r[0], {
      x: 5.8, y: y - 0.05, w: 3.5, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.navy, margin: 0,
    });
    s.addText(r[1], {
      x: 5.8, y: y + 0.2, w: 3.5, h: 0.3,
      fontFace: FONT_B, fontSize: 10, color: C.muted, margin: 0,
    });
  });
}

// ─── スライド17: 導入スケジュール ──────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  addHeader(s, "08  導入スケジュール（目安）", 17, 18);

  s.addText("個人開発・学習を兼ねたペースで、運用開始までの目安は 1〜2ヶ月", {
    x: 0.6, y: 0.85, w: 9, h: 0.35,
    fontFace: FONT_B, fontSize: 13, color: C.muted, margin: 0,
  });

  const phases = [
    { n: "1", title: "基盤構築",       weeks: "1-2週", detail: "ログイン、講師登録、画面の土台" },
    { n: "2", title: "講師機能",       weeks: "1-2週", detail: "固定シフト登録・講習希望提出・欠勤申請" },
    { n: "3", title: "教室長機能",     weeks: "1-2週", detail: "期間管理、希望俯瞰、Excelアップロード" },
    { n: "4", title: "交代・承認",     weeks: "1週",   detail: "交代・代講フロー、承認画面" },
    { n: "5", title: "仕上げ",         weeks: "1週",   detail: "スマホ調整、セキュリティ、本番公開" },
  ];

  const baseY = 1.4;
  phases.forEach((p, i) => {
    const y = baseY + i * 0.62;
    // 番号バッジ
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.6, y: y, w: 0.6, h: 0.5,
      fill: { color: C.navy }, line: { color: C.navy },
    });
    s.addText(`Phase ${p.n}`, {
      x: 0.6, y: y, w: 0.6, h: 0.5,
      fontFace: FONT_H, fontSize: 9, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
    // 期間
    s.addShape(pres.shapes.RECTANGLE, {
      x: 1.3, y: y, w: 1.2, h: 0.5,
      fill: { color: C.accentLight }, line: { color: C.accent, width: 1 },
    });
    s.addText(p.weeks, {
      x: 1.3, y: y, w: 1.2, h: 0.5,
      fontFace: FONT_H, fontSize: 11, bold: true, color: C.accent,
      align: "center", valign: "middle", margin: 0,
    });
    // タイトル
    s.addText(p.title, {
      x: 2.6, y: y + 0.03, w: 2, h: 0.25,
      fontFace: FONT_H, fontSize: 13, bold: true, color: C.navy, margin: 0,
    });
    s.addText(p.detail, {
      x: 2.6, y: y + 0.25, w: 6.8, h: 0.25,
      fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0,
    });
  });

  // 下部強調
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 4.7, w: 8.8, h: 0.55,
    fill: { color: C.navy }, line: { color: C.navy },
  });
  s.addText([
    { text: "運用開始までの目安:  ", options: { color: C.ice, fontSize: 13 } },
    { text: "1〜2ヶ月", options: { color: C.accent, fontSize: 16, bold: true } },
    { text: "   （実物Excelをいただけると実装が加速します）", options: { color: C.ice, fontSize: 11 } },
  ], {
    x: 0.9, y: 4.72, w: 8.3, h: 0.5,
    fontFace: FONT_B, valign: "middle", margin: 0,
  });
}

// ─── スライド18: ご承認いただきたいポイント ────────
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  // 装飾（本文エリアと重ならないよう位置調整）
  s.addShape(pres.shapes.OVAL, {
    x: -2, y: -2, w: 4, h: 4,
    fill: { color: C.navyLight, transparency: 70 }, line: { color: C.navyLight, transparency: 70 },
  });
  s.addShape(pres.shapes.OVAL, {
    x: 8.8, y: -0.6, w: 2.2, h: 2.2,
    fill: { color: C.accent, transparency: 80 }, line: { color: C.accent, transparency: 80 },
  });

  // ページ番号（他スライドと合わせる）
  s.addText("18 / 18", {
    x: 8.4, y: 0.15, w: 1.2, h: 0.4,
    fontFace: FONT_B, fontSize: 11, color: C.ice,
    valign: "middle", align: "right", margin: 0,
  });
  // タイトル
  s.addText("ご承認いただきたいポイント", {
    x: 0.6, y: 0.5, w: 9, h: 0.7,
    fontFace: FONT_H, fontSize: 28, bold: true, color: C.white, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 1.2, w: 1.5, h: 0.05,
    fill: { color: C.accent }, line: { color: C.accent },
  });

  const asks = [
    { n: "1", title: "現在の Excel フォーマットの共有", d: "週次シフト Excel を 1〜2 週分サンプルとしてご提供ください" },
    { n: "2", title: "コマの時間帯の確定", d: "1限〜何限まで、各コマの開始・終了時刻" },
    { n: "3", title: "講師・管理者の人数", d: "運用開始時点での登録対象人数の目安" },
    { n: "4", title: "講習期間の名称と回数", d: "春期・夏期・冬期・直前講習 等" },
    { n: "5", title: "本システム開発・導入のご許可", d: "上記前提で MVP 開発を進めてよいか" },
  ];

  asks.forEach((a, i) => {
    const y = 1.55 + i * 0.68;
    // 番号
    s.addShape(pres.shapes.OVAL, {
      x: 0.7, y: y, w: 0.5, h: 0.5,
      fill: { color: C.accent }, line: { color: C.accent },
    });
    s.addText(a.n, {
      x: 0.7, y: y, w: 0.5, h: 0.5,
      fontFace: FONT_H, fontSize: 18, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(a.title, {
      x: 1.35, y: y - 0.02, w: 8, h: 0.3,
      fontFace: FONT_H, fontSize: 14, bold: true, color: C.white, margin: 0,
    });
    // 本文はコントラスト確保のためほぼ白に変更
    s.addText(a.d, {
      x: 1.35, y: y + 0.28, w: 8, h: 0.3,
      fontFace: FONT_B, fontSize: 11, color: "F5F8FF", margin: 0,
    });
  });

  // フッター
  s.addText("ご不明点・ご要望があればお気軽にお知らせください。", {
    x: 0.6, y: 5.15, w: 9, h: 0.3,
    fontFace: FONT_B, fontSize: 11, color: "F5F8FF", italic: true, margin: 0,
  });
}

// ─── 保存 ────────────────────────────────
pres.writeFile({ fileName: path.join(__dirname, "shift-manager_UI仕様書.pptx") })
  .then(fn => console.log("Generated:", fn));
