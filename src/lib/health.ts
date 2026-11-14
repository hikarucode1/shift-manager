/**
 * 死活監視用の判定 (#275)。DB に軽いクエリを投げ、時間内に通れば ok。
 * 画面は loading.tsx のせいで障害時も 200 を返すので (#190)、監視は
 * /api/health のステータスコードで見る。
 *
 * 返す中身は ok の真偽だけ。エラーの詳細や接続先は外に出さない。
 */
export const HEALTH_TIMEOUT_MS = 5000;

export async function checkHealth(
  probe: () => Promise<unknown>,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<{ status: 200 | 503; body: { ok: boolean } }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health probe timed out")), timeoutMs);
  });
  try {
    await Promise.race([probe(), timeout]);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    console.error("[health] probe failed", e);
    return { status: 503, body: { ok: false } };
  } finally {
    clearTimeout(timer);
  }
}
