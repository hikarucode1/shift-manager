/**
 * #348: 講師が担当できる科目と文理。教室の「講師の情報シート」と同じ分け方
 * (2026-11-16 本人)。DB には key を保存する (表示名を変えても既存の登録が崩れない)。
 */

export const TRACKS = [
  { key: "science", label: "理系" },
  { key: "humanities", label: "文系" },
  { key: "both", label: "どちらも" },
] as const;
export type TrackKey = (typeof TRACKS)[number]["key"];

export type SubjectDef = { key: string; label: string };
export type SubjectGroup = {
  /** "中学生" / "高校生" */
  level: string;
  /** 小見出し (公共・地歴)。無ければ null */
  sub: string | null;
  subjects: SubjectDef[];
};

export const SUBJECT_GROUPS: SubjectGroup[] = [
  {
    level: "中学生",
    sub: null,
    subjects: [
      { key: "jh_en", label: "英" },
      { key: "jh_math", label: "数" },
      { key: "jh_ja", label: "国" },
      { key: "jh_sci", label: "理" },
      { key: "jh_soc", label: "社" },
    ],
  },
  {
    level: "高校生",
    sub: null,
    subjects: [
      { key: "hs_en", label: "英" },
      { key: "hs_kobun", label: "古文" },
      { key: "hs_essay", label: "小論" },
      { key: "hs_math1a", label: "数IA" },
      { key: "hs_math2bc", label: "数IIBC" },
      // シートの「統計※」は数B の一部 (11/16 本人)
      { key: "hs_stats", label: "統計（数B）" },
      { key: "hs_math3", label: "数III" },
      { key: "hs_phys", label: "物理" },
      { key: "hs_chem", label: "化学" },
      { key: "hs_bio", label: "生物" },
      { key: "hs_info", label: "情報" },
    ],
  },
  {
    level: "高校生",
    sub: "公共",
    subjects: [
      { key: "hs_ethics", label: "倫理" },
      { key: "hs_politics", label: "政経" },
    ],
  },
  {
    level: "高校生",
    sub: "地歴",
    subjects: [
      { key: "hs_jhist", label: "日本史" },
      { key: "hs_whist", label: "世界史" },
      { key: "hs_geo", label: "地理" },
    ],
  },
];

export const ALL_SUBJECT_KEYS: string[] = SUBJECT_GROUPS.flatMap((g) =>
  g.subjects.map((s) => s.key),
);

const LABEL_BY_KEY = new Map(
  SUBJECT_GROUPS.flatMap((g) =>
    g.subjects.map((s) => [
      s.key,
      `${g.level === "中学生" ? "中" : "高"}${s.label}`,
    ]),
  ),
);

/** 「中英」「高数IA」のような短い表示名。知らない key はそのまま */
export function subjectShortLabel(key: string): string {
  return LABEL_BY_KEY.get(key) ?? key;
}

export function trackLabel(key: string | null): string | null {
  return TRACKS.find((t) => t.key === key)?.label ?? null;
}

/** 選択肢の並び順にそろえ、知らない key と重複を落とす */
export function normalizeSubjects(keys: readonly string[]): string[] {
  const set = new Set(keys);
  return ALL_SUBJECT_KEYS.filter((k) => set.has(k));
}

/**
 * 保存前の確認 (#348 講師本人 / #349 教室長 で共通)。
 * 文理は必須、科目は 1 つ以上。知らない key は弾く。
 */
export function checkTeachingProfile(input: {
  track: unknown;
  subjects: unknown;
}):
  | { ok: true; track: TrackKey; subjects: string[] }
  | { ok: false; error: string } {
  const { track, subjects } = input;
  if (
    !Array.isArray(subjects) ||
    subjects.length > ALL_SUBJECT_KEYS.length ||
    !subjects.every((k) => typeof k === "string" && ALL_SUBJECT_KEYS.includes(k))
  ) {
    return { ok: false, error: "入力が不正です。" };
  }
  if (track === null || track === undefined) {
    return { ok: false, error: "理系・文系を選んでください。" };
  }
  if (!TRACKS.some((t) => t.key === track)) {
    return { ok: false, error: "入力が不正です。" };
  }
  const normalized = normalizeSubjects(subjects);
  if (normalized.length === 0) {
    return { ok: false, error: "担当できる科目を 1 つ以上選んでください。" };
  }
  return { ok: true, track: track as TrackKey, subjects: normalized };
}

/** 一覧の絞り込み: 「理系」には「どちらも」の人も入れる */
export function matchesTrackFilter(
  track: string | null,
  filter: TrackKey | "none" | null,
): boolean {
  if (!filter) return true;
  if (filter === "none") return !TRACKS.some((t) => t.key === track);
  if (filter === "both") return track === "both";
  return track === filter || track === "both";
}
