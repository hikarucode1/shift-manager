import "server-only";

/**
 * SystemUnavailable に出す問い合わせ用 ID を採番し、同じ値でサーバーログに残す (#188)。
 *
 * エラー境界 (error.tsx) は Next が採番した `error.digest` を受け取れるが、
 * layout / `/` / `/login` の捕捉は境界ではないので digest が無い。
 * 「教室長にご連絡ください」と言いながら添えるものが何も無い状態を避けるため、
 * ここで採番してログと画面の両方に出す。
 *
 * 画面に出るので短く読み上げやすい長さに切る。衝突しても実害は無い
 * (ログを時刻で絞り込むための手がかりであって、一意キーではない)。
 */
export function reportIncident(scope: string, error: unknown): string {
  const incidentId = crypto.randomUUID().slice(0, 8);
  console.error(`[${scope}] incident=${incidentId}`, error);
  return incidentId;
}
