/**
 * 申請台帳の行モデル (#224)。
 *
 * 承認済み / 取り消し済みの一覧は、DB 上は `swap_requests` と `absence_requests`
 * の 2 テーブルだが、教室長から見ると「いつ・誰の・どのコマが・どうなったか」の
 * 1 本の時系列。画面ごとに `readOnly ? … : …` や `isProxy && …` で組み立てると、
 * **行の種類が増えるたびに嘘が出る**。実際 2026-08 の 1 日で 3 回起きた:
 *   - 記録行 (#215) に「代講募集」と出た
 *   - 記録行に「承認日時」と出た
 *   - 自動失効した欠勤に「取り消し: (承認した人の名前)」と出た
 *
 * そこで**行の種類の判定をここに集約し、テストで固定する**。画面は
 * `eventLabel` と各フィールドを並べるだけにして、分岐を持たない。
 *
 * ⚠️ DB の型に依存しない引数にしてある。実 DB が無い環境でテストするため
 * (このリポジトリのテストは全て純関数レベル)。
 */

export type RequestLogKind = "absence" | "swap";

/**
 * その行が「今の状態にどうやってなったか」。
 * status だけでは足りない — 同じ `cancelled` でも 4 経路ある。
 */
export type RequestLogEvent =
  /** 未対応 (台帳には出ないが、判定を全域にするため持つ) */
  | "pending"
  /** 講師の申請を教室長が承認した */
  | "approved"
  /** 教室長が代理で登録した (#217、欠勤のみ。pending を経由しない) */
  | "registered"
  /** 教室長が「誰が入ったか」を直接記録した (#215、交代のみ) */
  | "recorded"
  /** 教室長が却下した */
  | "rejected"
  /** 教室長が承認済みを取り消した (#213 / #219) */
  | "cancelled-by-admin"
  /** 教室長が承認前の代理募集を取り下げた (#231、交代のみ) */
  | "withdrawn-by-admin"
  /** 講師が自分で取り下げた */
  | "cancelled-by-tutor"
  /** 交代成立により欠勤が自動失効した (欠勤のみ) */
  | "auto-expired";

export type RequestLogEntry = {
  id: string;
  kind: RequestLogKind;
  event: RequestLogEvent;
  /** 台帳の並びキー。決定日時、無ければ更新日時 (#233 と同じ規則) */
  occurredAt: string;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  /** 「誰の」コマか (欠勤した講師 / 交代を頼んだ講師) */
  subjectName: string;
  /**
   * 実際に入った講師。**承認前に閉じた行では null** — ここを
   * 「不明」と出すと「代講者が分からなくなった」に見える (#240)
   */
  substituteName: string | null;
  /** 操作した教室長。自己取り下げ・自動失効では null */
  actorName: string | null;
  /** 申請時の理由 */
  reason: string;
  /** 決定時のコメント (却下理由・取り消し理由など) */
  note: string | null;
  /** 画面に出す種類のラベル */
  eventLabel: string;
  /**
   * 教室長が起点の行か (#217 の代理登録 / #227 の代理募集 / #215 の記録)。
   * 「講師が頼んだのか、教室長が手配したのか」は event と直交する軸
   */
  adminInitiated: boolean;
  /**
   * 承認済みの取り消し (#213 / #219) を出してよいか。
   * ⚠️ #231 の「取り下げ」(pending が対象) はこれでは表せない
   */
  cancellable: boolean;
};

export const EVENT_LABEL: Record<RequestLogEvent, string> = {
  pending: "未対応",
  approved: "承認",
  registered: "代理登録",
  recorded: "記録",
  rejected: "却下",
  "cancelled-by-admin": "取り消し",
  "withdrawn-by-admin": "教室長が取り下げ",
  "cancelled-by-tutor": "講師が取り下げ",
  "auto-expired": "失効（交代成立による）",
};

export type LogStatus = "pending" | "approved" | "rejected" | "cancelled";

type CommonInput = {
  id: string;
  status: LogStatus;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  reason: string;
  note: string | null;
  /** 決定した教室長の表示名。自己取り下げ・自動失効では null */
  actorName: string | null;
  decidedAt: string | null;
  updatedAt: string;
};

export type AbsenceLogInput = CommonInput & {
  tutorName: string;
  /**
   * 教室長が作った行か (#217)。**必ず `created_by !== null && created_by !==
   * tutor_id` で判定すること**。0034 は backfill 無しの列追加なので、それ以前の
   * 行は `created_by = null` (＝講師本人が作った行)。null を無視すると
   * **過去の承認済み欠勤が全部「代理登録」になる**。
   */
  isProxy: boolean;
  /** `decision_note` が交代成立の自動失効マーカーと一致するか */
  autoExpired: boolean;
};

export type SwapLogInput = CommonInput & {
  requesterName: string;
  /**
   * 教室長が作った行か (#227 の代理募集)。判定は欠勤側と同じ
   * (`created_by !== null && created_by !== requester_id`)。
   *
   * ⚠️ **event には畳み込まない。** 代理募集は pending を経て普通に承認される
   * ので、起きた出来事は「承認」で正しい。一方「山田が頼んだのか教室長が
   * 出したのか」は承認・却下・取り下げのどれとも直交するため、別の軸で持つ。
   * (欠勤の `registered` は承認ステップ自体が無いので event 側で表す)
   */
  isProxy: boolean;
  /** 承認された代講者。承認前に閉じた行では null */
  approvedApplicantName: string | null;
  /** `kind === "recorded"` (#215) */
  isRecorded: boolean;
};

function base(
  i: CommonInput,
  kind: RequestLogKind,
  event: RequestLogEvent,
  subjectName: string,
  substituteName: string | null,
  adminInitiated: boolean,
): RequestLogEntry {
  return {
    id: i.id,
    kind,
    event,
    // #233 と同じ規則。decided_at が無い行 (講師の自己取り下げ) は
    // updated_at が実質その遷移時刻
    occurredAt: i.decidedAt ?? i.updatedAt,
    date: i.date,
    slotNumber: i.slotNumber,
    slotLabel: i.slotLabel,
    weekdayLabel: i.weekdayLabel,
    subjectName,
    substituteName,
    actorName: i.actorName,
    reason: i.reason,
    note: i.note,
    eventLabel: EVENT_LABEL[event],
    adminInitiated,
    cancellable: i.status === "approved",
  };
}

/** 欠勤申請 1 行 → 台帳の行 */
export function toAbsenceLogEntry(i: AbsenceLogInput): RequestLogEntry {
  const event: RequestLogEvent =
    i.status === "pending"
      ? "pending"
      : i.status === "rejected"
        ? "rejected"
        : i.status === "approved"
          ? // 代理登録は pending を経由せず直接 approved になる (#217)。
            // 「承認」と出すと、誰も判断していない手続きを主張することになる
            i.isProxy
            ? "registered"
            : "approved"
          : // ---- cancelled ----
            // ⚠️ 自動失効の判定を actorName より先に見る。理由は「時刻」では
            // ない — #225 以降、自動失効は `decided_by` を**明示的に null に
            // する**ので、順序を入れ替えると「講師が取り下げ」に落ちる。
            //
            // ⚠️ note の文字列一致だけに頼らない。`cancelApprovedAbsence` の
            // 理由欄は自由文なので、教室長が偶然 同じ文言を書くと
            // (アプリ外で代講を手配した場合に十分あり得る) 本人の判断が
            // 「失効」に化ける。自動失効は必ず actorName が無いので AND で縛る
            i.autoExpired && i.actorName === null
            ? "auto-expired"
            : i.actorName !== null
              ? "cancelled-by-admin"
              : "cancelled-by-tutor";
  // 欠勤に代講者の概念は無い
  return base(i, "absence", event, i.tutorName, null, i.isProxy);
}

/** 交代・代講申請 1 行 → 台帳の行 */
export function toSwapLogEntry(i: SwapLogInput): RequestLogEntry {
  const event: RequestLogEvent =
    i.status === "pending"
      ? "pending"
      : i.status === "rejected"
        ? "rejected"
        : i.status === "approved"
          ? i.isRecorded
            ? "recorded"
            : "approved"
          : // ---- cancelled ----
            i.actorName === null
            ? "cancelled-by-tutor"
            : // 承認済みを取り消したのか、承認前の代理募集を取り下げたのか。
              // 代講者が決まっていたかで区別する (#231 / #240)
              i.approvedApplicantName !== null
              ? "cancelled-by-admin"
              : "withdrawn-by-admin";
  return base(
    i,
    "swap",
    event,
    i.requesterName,
    i.approvedApplicantName,
    i.isProxy || i.isRecorded,
  );
}

/**
 * 2 テーブル分を 1 本の時系列にまとめる。
 *
 * ⚠️ **各グループは `limit + 1` 件ずつ取ったものを渡すこと。** マージ後の上位
 * `limit` 件は 1 グループから最大 `limit` 件しか来ないので、`limit + 1` 件目より
 * 後の行が上位に入ることはない。`truncated` は「まだ先がある」の意 (件数ではない)。
 *
 * ⚠️ **SQL 側の第 2 ソートキーを `id` に揃えること。** 現在の
 * `getSwapHistory` / `getAbsenceHistory` は `slot_number ASC` で切っているため、
 * 同一グループ内に `occurredAt` が完全一致する行が `limit + 1` 件以上あると、
 * SQL とここで別の行が選ばれて取りこぼす。全経路が JS の `new Date()` なので
 * 同一ミリ秒の衝突は現実的ではないが、不変条件としては噛み合っていない。
 *
 * 引数が配列の配列なのは、承認済み/取り消し済みのように**取得が 2 本を超える**
 * ため。入れ子で呼ぶと `truncated` の意味が壊れるので、必ず一度に渡す。
 */
export function mergeLogEntries(
  groups: RequestLogEntry[][],
  limit: number,
): { rows: RequestLogEntry[]; truncated: boolean } {
  const all = groups.flat().sort((x, y) => {
    // 決定が新しい順。`occurredAt` は必ず `Date#toISOString()` の出力
    // (常に UTC の `Z` + ミリ秒 3 桁) なので、単純な文字列比較で時系列順になる。
    // localeCompare は使わない — ロケール依存で遅く、`+09:00` 表記が混ざった
    // 場合に同一時刻を -1 と答えるなど、前提が崩れたときに黙って間違える
    if (x.occurredAt !== y.occurredAt) return x.occurredAt < y.occurredAt ? 1 : -1;
    // 同時刻は id で安定させる (ページングの前提)
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  return { rows: all.slice(0, limit), truncated: all.length > limit };
}
