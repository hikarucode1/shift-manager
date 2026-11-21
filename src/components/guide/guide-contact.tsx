import Link from "next/link";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { withFrom, type Guide } from "@/lib/guide";

/**
 * 使い方の一番下に置く「解決しないときは」。ヘッダーの「？」を使い方の入口に
 * したので、お問い合わせ (#320) へはここから入る
 */
export function GuideContact({
  guide,
  from,
}: {
  guide: Guide;
  /** お問い合わせに「どの画面で」として渡すパス */
  from: string | null;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        解決しないときは
      </h2>
      <Link
        href={withFrom(`${guide.base}/contact`, from)}
        className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
      >
        <MessageCircleQuestion className="size-5 shrink-0 text-primary" />
        <span className="flex-1">
          <span className="block text-sm font-medium">お問い合わせ</span>
          <span className="block text-xs text-muted-foreground">
            使い方で分からないことや、おかしな動きを開発者に送れます。
            {guide.role === "tutor" &&
              "シフトの相談は今までどおり教室長へお願いします。"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </section>
  );
}
