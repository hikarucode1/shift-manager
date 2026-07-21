"use client";

import { useEffect } from "react";
import { markReadAction } from "./actions";

/**
 * 一覧を開いたら表示中の未読を既読化する (#155)。
 * 未読ハイライトはこの訪問中は残したいため、既読化後に一覧は再描画しない
 * (ベルのバッジは NotificationBell が遷移/ポーリングで取り直す)。
 */
export function MarkReadOnMount({ ids }: { ids: string[] }) {
  useEffect(() => {
    if (ids.length > 0) {
      void markReadAction(ids).catch(() => {
        /* 既読化失敗は次回訪問時に再試行されるため無視 */
      });
    }
    // 初回マウント時のみで良い (ids はサーバー描画時点の未読一覧)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
