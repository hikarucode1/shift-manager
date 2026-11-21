"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 表示の何倍の細かさで描くか。スマホでは横向きの A4 が小さく出るので、
 * 指で拡大したときに字がぼやけないよう細かく描いておく
 */
const SHARPNESS = 2;
/**
 * 1 ページの canvas の上限 (px)。iOS Safari は約 1677 万 px を超える canvas を
 * 黙って真っ白にするので、十分手前で止める
 */
const MAX_CANVAS_PIXELS = 8_000_000;

type State = "loading" | "ready" | "error";

/**
 * PDF をアプリの画面の中に描く (pdf.js)。
 *
 * ⚠️ PDF を `target="_blank"` や URL そのままで開かないこと。ホーム画面に追加
 * したアプリ (PWA の standalone 表示) にはタブも「戻る」も無く、PDF が画面
 * いっぱいに出たまま戻れなくなる (2026/11/21 本人)。PC のブラウザではタブを
 * 閉じれば戻れるので、PC で確かめても気づけない。
 *
 * pdf.js は重い (本体 0.5MB + worker 1.3MB) ので、この部品を出したときだけ読む。
 */
export function PdfViewer({
  src,
  title,
}: {
  /** 同じサイトの PDF の URL (ログインの cookie を付けて取りに行く) */
  src: string;
  /** 読み上げ用の名前 (例: 「2026年12月のスケジュール」) */
  title: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("loading");
  // 「もう一度読み込む」を押すたびに増やして、描き直す
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const abort = new AbortController();
    let closeDocument: (() => void) | null = null;

    (async () => {
      // 古いブラウザ向けの版を使う (iPhone は iOS 16.4 から。通知の条件と同じ)
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const res = await fetch(src, {
        credentials: "same-origin",
        signal: abort.signal,
      });
      // ログインが切れていると /login の HTML が 200 で返るので、種類も見る
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("application/pdf")) {
        throw new Error(`PDF を取得できませんでした (${res.status} ${type})`);
      }
      const data = new Uint8Array(await res.arrayBuffer());
      if (abort.signal.aborted) return;

      const task = pdfjs.getDocument({ data });
      closeDocument = () => void task.destroy();
      const doc = await task.promise;

      const cssWidth = host.clientWidth;
      const density = Math.min(window.devicePixelRatio || 1, 3) * SHARPNESS;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        let scale = (cssWidth / base.width) * density;
        const pixels = base.width * scale * (base.height * scale);
        if (pixels > MAX_CANVAS_PIXELS) {
          scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
        }
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "block h-auto w-full rounded-md border bg-white shadow-sm";
        canvas.setAttribute("role", "img");
        canvas.setAttribute(
          "aria-label",
          doc.numPages > 1 ? `${title} ${n} / ${doc.numPages} ページ` : title,
        );
        await page.render({ canvas, viewport }).promise;
        if (abort.signal.aborted) return;
        host.appendChild(canvas);
      }
      setState("ready");
    })().catch((e) => {
      if (abort.signal.aborted) return;
      console.error("PdfViewer: PDF を表示できませんでした", e);
      setState("error");
    });

    return () => {
      abort.abort();
      closeDocument?.();
      host.replaceChildren();
    };
  }, [src, title, attempt]);

  return (
    <div className="space-y-3">
      {state === "loading" && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" />
          PDF を読み込んでいます…
        </p>
      )}
      {state === "error" && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-dashed p-6 text-center"
        >
          <p className="flex items-center justify-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="size-4" />
            PDF を表示できませんでした。
          </p>
          <p className="text-xs text-muted-foreground">
            通信の状態を確かめて、もう一度読み込んでください。
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setState("loading");
              setAttempt((n) => n + 1);
            }}
          >
            もう一度読み込む
          </Button>
        </div>
      )}
      {/* ページの canvas はここに足す (React は中身を持たない) */}
      <div ref={hostRef} className="space-y-3" />
      {state === "ready" && (
        // 指で操作する端末 (スマホ・タブレット) にだけ出す
        <p className="hidden text-center text-xs text-muted-foreground touch:block">
          字が小さいときは、2 本の指で広げると拡大できます。
        </p>
      )}
    </div>
  );
}
