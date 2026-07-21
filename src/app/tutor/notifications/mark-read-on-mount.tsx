"use client";

import { useEffect } from "react";
import { markAllReadAction } from "./actions";

/**
 * 一覧を開いたら未読を全件既読化する (#155)。
 * 表示分 (最新 50 件) だけの既読化だと 50 件超の未読が残ったとき
 * バッジが永久に消せないため、全件を対象にする (PR #168 レビュー指摘)。
 * 未読ハイライトはこの訪問中は残したいため、既読化後に一覧は再描画しない。
 */
export function MarkReadOnMount() {
  useEffect(() => {
    // 表示中に未読が無くても、51 件目以降に埋もれた未読が残っている可能性が
    // あるため常に呼ぶ (未読ゼロなら DB 上 no-op)
    void markAllReadAction().catch(() => {
      /* 既読化失敗は次回訪問時に再試行されるため無視 */
    });
  }, []);
  return null;
}
