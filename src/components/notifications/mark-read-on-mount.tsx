"use client";

import { useEffect } from "react";
import { markAllReadAction } from "@/app/tutor/notifications/actions";
import { markAllAdminReadAction } from "@/app/admin/notifications/actions";

/**
 * 一覧を開いたら未読を全件既読化する (#155)。
 * 表示分 (最新 50 件) だけの既読化だと 50 件超の未読が残ったとき
 * バッジが永久に消せないため、全件を対象にする (PR #168 レビュー指摘)。
 * 未読ハイライトはこの訪問中は残したいため、既読化後に一覧は再描画しない。
 * #344: 既読にするのは開いた画面 (講師 / 教室長) 向けの分だけ。
 */
export function MarkReadOnMount({ audience }: { audience: "tutor" | "admin" }) {
  useEffect(() => {
    const markAll =
      audience === "admin" ? markAllAdminReadAction : markAllReadAction;
    // 表示中に未読が無くても、51 件目以降に埋もれた未読が残っている可能性が
    // あるため常に呼ぶ (未読ゼロなら DB 上 no-op)
    // action-failure: ok — 既読化はマウント時の自動実行なので、失敗しても
    // 利用者に見せない (押した操作ではない)。#168 の「ポーリングから強制遷移
    // させない」と同じ判断。
    void markAll().catch(() => {
      /* 既読化失敗は次回訪問時に再試行されるため無視 */
    });
  }, [audience]);
  return null;
}
