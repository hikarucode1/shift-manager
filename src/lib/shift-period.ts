/**
 * Issue #73 (γ): 期 (regular_shift_periods) を月初日のリストに分解する pure 関数。
 *
 * 期は日付単位 (start_date / end_date) で表現されるが、確定テーブル
 * monthly_regular_assignments は target_month (月初固定) でキー付けされる。
 * 「期一括確定」操作で期内の各月に同じ confirmedSet を bulk INSERT するため、
 * 期を月リストに展開する必要がある。
 *
 * 期中始動 (例: start_date = 2026-04-16) や月途中終了 (end_date = 2026-06-15)
 * でも、その月の月初 (2026-04-01 / 2026-06-01) を含める = 月単位でいったん
 * 確定を入れ、日単位の細かい例外は後追い Issue #74 (effective_from/to ベース)
 * で扱う。
 */
/**
 * Issue #74 (δ): "YYYY-MM-01" → "YYYY-MM-LL" (その月の末日 ISO)。
 *
 * regular_assignments の effective_to に「月末」をセットするときに使う。
 * 末日は月とうるう年で変わるため、JavaScript Date の「翌月の 0 日目 = 今月末」
 * トリックで取得する (UTC ベースで JST 影響なし)。
 *
 * monthFirstIso が "YYYY-MM-01" 形式でない場合は空文字を返す。
 */
export function lastDayOfMonth(monthFirstIso: string): string {
  const m = /^(\d{4})-(\d{2})-01$/.exec(monthFirstIso);
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  // Date.UTC(year, monthIndex=month, day=0) = 翌月の 0 日目 = 今月末
  const last = new Date(Date.UTC(year, month, 0));
  const dd = String(last.getUTCDate()).padStart(2, "0");
  return `${m[1]}-${m[2]}-${dd}`;
}

/**
 * Issue #74 follow-up: ISO 日付 "YYYY-MM-DD" の前日 / 翌日。
 * regular_assignments の overlap 分割で「monthStart の前日」「monthEnd の翌日」
 * を算出するのに使う。
 */
export function prevDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export type DateRange = {
  effectiveFrom: string;
  effectiveTo: string;
};

/**
 * Issue #74 follow-up: 既存の有効範囲から「対象月 [monthStart, monthEnd] と
 * 重なる部分」を除いた残りを返す pure 関数。
 *
 * 例:
 *   - 既存 (4/1-6/30) を 5月 で削ると → (4/1-4/30) と (6/1-6/30)
 *   - 既存 (5/10-5/20) を 5月 で削ると → []
 *   - 既存 (3/1-3/31) を 5月 で削ると → (3/1-3/31)
 *
 * 入力は inclusive。effective_to NULL のケースは呼び出し側で
 * period.end_date 等に解決してから渡す前提 (本関数は実日付のみ扱う)。
 *
 * 既存行に対し saveMonthlyConfirmation の DELETE が触る境界条件と整合させる:
 * 「対象月の effective_from を含む行のみ DELETE」では取りこぼす期一括行を
 * このヘルパで「月の外側の残り部分」に分割し直して保存する。
 */
export function splitRangeRemovingMonth(
  existing: DateRange,
  monthStart: string,
  monthEnd: string,
): DateRange[] {
  // overlap なし (既存が月の前 or 月の後)
  if (existing.effectiveTo < monthStart || existing.effectiveFrom > monthEnd) {
    return [existing];
  }
  const result: DateRange[] = [];
  if (existing.effectiveFrom < monthStart) {
    result.push({
      effectiveFrom: existing.effectiveFrom,
      effectiveTo: prevDay(monthStart),
    });
  }
  if (existing.effectiveTo > monthEnd) {
    result.push({
      effectiveFrom: nextDay(monthEnd),
      effectiveTo: existing.effectiveTo,
    });
  }
  return result;
}

export function monthsInPeriod(
  startDate: string,
  endDate: string,
): string[] {
  const [syRaw, smRaw] = startDate.split("-");
  const [eyRaw, emRaw] = endDate.split("-");
  const sy = Number(syRaw);
  const sm = Number(smRaw);
  const ey = Number(eyRaw);
  const em = Number(emRaw);

  if (
    !Number.isInteger(sy) ||
    !Number.isInteger(sm) ||
    !Number.isInteger(ey) ||
    !Number.isInteger(em)
  ) {
    return [];
  }
  if (ey < sy || (ey === sy && em < sm)) return [];

  const result: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
}
