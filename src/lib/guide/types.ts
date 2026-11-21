/**
 * アプリ内の操作マニュアル「アプリの使い方」(2026/11/21 本人依頼) の型。
 *
 * 教室長用と講師用を別々に持ち、自分の役割の分だけを見せる。「やりたいこと」
 * ごとに 1 ページ (トピック) で、どの画面のどのボタンを押すかを手順で書く。
 * 中身は `tutor.ts` / `admin.ts` に文章として持つ (DB には入れない)。
 */

export type GuideRole = "tutor" | "admin";

/** 手順に添える画面の画像。`public/guide/` に置く (ダミーのデータだけを写す) */
export type GuideImage = {
  /** `/guide/tutor/xxx.webp` の形。`public/` からの絶対パス */
  src: string;
  /** 画像が見えない人向けの説明 */
  alt: string;
  /** 画像そのものの大きさ (px)。表示のがたつきを防ぐために必ず持つ */
  width: number;
  height: number;
  /** 画面に出す幅の上限 (px)。画像は倍の密度で撮っているので、width より小さい */
  displayWidth: number;
};

export type GuideStep = {
  /**
   * 手順の文。ボタンや画面の名前は「」で囲む (画面では太字になる)。
   * 名前は実際の画面の文言と同じにすること
   */
  text: string;
  /** 補足 (1〜2 文)。無くてもよい */
  detail?: string;
  image?: GuideImage;
};

export type GuideNote = {
  /** tip = 知っておくと便利、caution = 気をつけること */
  kind: "tip" | "caution";
  text: string;
};

export type GuideSection = {
  /** 場面が分かれるときの見出し (例: 「指名されたとき」)。1 つだけなら省く */
  heading?: string;
  /** 手順の前に置く説明 */
  intro?: string;
  /**
   * 手順の前に置く画像 (画面の見方の説明用)。画像の中の番号 ①②③… が、
   * 下の手順の番号と合うように撮る
   */
  image?: GuideImage;
  steps: GuideStep[];
  notes?: GuideNote[];
};

export type GuideTopic = {
  /** URL に入る名前。半角英小文字と - だけ */
  slug: string;
  /** やりたいこと (例: 「欠勤を申請する」) */
  title: string;
  /** 一覧に出す 1 行の説明 */
  summary: string;
  category: string;
  /**
   * このトピックが関係する画面のパス。ヘッダーの「？」を押したとき、
   * 開いていた画面に合うトピックを一番上に出すのに使う (前方一致)
   */
  screens: string[];
  sections: GuideSection[];
  /** その画面をすぐ開くボタン */
  open?: { href: string; label: string };
  /** あわせて読むトピックの slug */
  related?: string[];
};

export type GuideCategory = { id: string; title: string };

export type Guide = {
  role: GuideRole;
  /** "/tutor" か "/admin" */
  base: "/tutor" | "/admin";
  /** だれ向けか (見出しに出す) */
  audience: string;
  categories: GuideCategory[];
  topics: GuideTopic[];
};
