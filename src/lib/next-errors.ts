import "server-only";

/**
 * Next の制御フロー例外 (redirect() / notFound() / forbidden() など) かどうか。
 *
 * これらは「エラー」ではなく Next が投げる制御フローで、Server Component の
 * try/catch で握り潰すと本来の遷移が起きない。認可チェックの redirect を
 * 飲み込むと権限バイパスになりうるため、catch の先頭で必ず再 throw する。
 *
 * 判定は digest 文字列で行う (`isRedirectError` は next の内部モジュール
 * なので公開 API から使えない)。digest は Next が付与する安定した接頭辞。
 */
export function isNextControlFlowError(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null | undefined)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") ||
      digest === "NEXT_NOT_FOUND")
  );
}
