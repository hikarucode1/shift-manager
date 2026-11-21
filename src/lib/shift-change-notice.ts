import { noticeDate } from "@/lib/week";

/**
 * 室長レビュー要望9 (2026/11/21 本人): 座席表を取り込み直してコマが変わったら、
 * 変わった講師全員に「何が変わったか」を通知する。未定のコマ (生徒も研修も
 * 体験も無い) にあとから授業や体験が入ることがあるので、それも知らせる。
 *
 * ⚠️ 初めての取り込み (その日付にまだコマが 1 つも無かった) は「変更」では
 * ないので、呼び出し側で送らない。
 */

export type ShiftCell = {
  tutorId: string;
  date: string;
  slotNumber: number;
  /** 生徒 (体験を含む) か研修が入っている。false = 未定のコマ */
  filled: boolean;
};

export type CellChangeKind =
  /** コマが増えた */
  | "added"
  /** 未定のコマに授業・体験・研修が入った */
  | "filled"
  /** 授業・体験・研修が無くなり、未定になった */
  | "emptied"
  /** コマが無くなった */
  | "removed";

export type CellChange = {
  kind: CellChangeKind;
  date: string;
  slotNumber: number;
  /**
   * `added` のとき、増えたコマが未定 (座席表に名前だけ) か。通知に
   * 「追加（未定）」と書き、授業が入ったと読ませない
   */
  undecided?: boolean;
};

/** 講師ごとの変わったコマ (日付・何限の順)。変わっていない講師は入らない */
export function shiftChangesByTutor(
  before: readonly ShiftCell[],
  after: readonly ShiftCell[],
): Map<string, CellChange[]> {
  const key = (c: ShiftCell) => `${c.tutorId}|${c.date}|${c.slotNumber}`;
  const b = new Map(before.map((c) => [key(c), c]));
  const a = new Map(after.map((c) => [key(c), c]));
  const out = new Map<string, CellChange[]>();
  const push = (c: ShiftCell, kind: CellChangeKind) => {
    const list = out.get(c.tutorId) ?? [];
    list.push({
      kind,
      date: c.date,
      slotNumber: c.slotNumber,
      ...(kind === "added" && !c.filled ? { undecided: true } : {}),
    });
    out.set(c.tutorId, list);
  };
  for (const [k, c] of a) {
    const prev = b.get(k);
    if (!prev) push(c, "added");
    else if (!prev.filled && c.filled) push(c, "filled");
    else if (prev.filled && !c.filled) push(c, "emptied");
  }
  for (const [k, c] of b) {
    if (!a.has(k)) push(c, "removed");
  }
  for (const list of out.values()) {
    list.sort((x, y) =>
      x.date === y.date ? x.slotNumber - y.slotNumber : x.date < y.date ? -1 : 1,
    );
  }
  return out;
}

const KIND_LABEL: Record<CellChangeKind, string> = {
  added: "追加",
  filled: "授業が入った",
  emptied: "未定になった",
  removed: "なし",
};

/** 1 通に書くコマの数の上限。超えた分は「ほか N コマ」 */
const MAX_LISTED = 6;

/**
 * 通知の本文。例:
 * 「授業が入った 12/3（木）5限、追加 12/4（金）3限、なし 12/5（土）2限」
 */
export function shiftChangeBody(
  changes: readonly CellChange[],
  slotLabel: (n: number) => string,
): string {
  const listed = changes
    .slice(0, MAX_LISTED)
    .map(
      (c) =>
        `${KIND_LABEL[c.kind]}${c.undecided ? "（未定）" : ""} ${noticeDate(c.date)}${slotLabel(c.slotNumber)}`,
    );
  const rest = changes.length - MAX_LISTED;
  return listed.join("、") + (rest > 0 ? `、ほか ${rest} コマ` : "");
}
