import "server-only";
import { unstable_rethrow } from "next/navigation";
import { reportIncident } from "@/lib/incident";

export type ShellGuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; incidentId: string };

/**
 * layout / `/` / `/login` で認可を解決し、失敗しても throw させない (#188)。
 *
 * これらは Suspense 境界の外なので、throw すると error.tsx では捕捉されず
 * 素の 500 になりシェルごと消える (#187 で実測)。呼び出し側は
 * `ok === false` のとき SystemUnavailable を返す。
 *
 * ⚠️ **`unstable_rethrow` が security-critical**。これが無いと権限不足の
 * `redirect()` まで握り潰し、権限バイパスになる。digest 文字列を自前で見る
 * 判定ではなく必ずこれを使うこと: drizzle は例外を DrizzleQueryError で包むため、
 * 包まれた制御フロー例外は表層に digest を持たず自前判定を素通りする
 * (`lib/db-errors.ts` の `pgErrorCode()` と同じ話)。unstable_rethrow は
 * `error.cause` を再帰的に辿るので取りこぼさない。
 *
 * ⚠️ この関数は**認可の境界ではない**。layout が children を描画しなくても
 * page の出力は RSC ペイロードに載って配信される (実測済み)。認可は各 page の
 * requireRole() が担保する前提を崩さないこと。
 *
 * 4 箇所に同じ try/catch を書き写すのをやめて 1 箇所に集約しているのは、
 * 重複を減らすためだけでなく、**上記の再 throw をテストで固定するため**
 * (shell-guard.test.ts)。呼び出し側に散らすとテストできず、誰かが
 * unstable_rethrow を消しても CI で落ちない。
 */
export async function resolveOrIncident<T>(
  scope: string,
  resolve: () => Promise<T>,
): Promise<ShellGuardResult<T>> {
  try {
    return { ok: true, value: await resolve() };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, incidentId: reportIncident(scope, e) };
  }
}
