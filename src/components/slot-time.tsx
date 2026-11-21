import { cn } from "@/lib/utils";

/**
 * コマの名前 (「6限」) の横に添える授業時間 (2026/11/21 本人)。
 * 時刻が分からないコマでは何も出さない
 */
export function SlotTime({
  time,
  className,
}: {
  /** `slotTimeRange()` の結果 ("19:50–21:20" か "") */
  time: string | undefined;
  className?: string;
}) {
  if (!time) return null;
  // 前の文字とは空白ひとつで離す。margin だと、折り返して行頭に来たときに
  // 字下げになって見える (flex の中では空白は無視され、gap が効く)
  return (
    <>
      {" "}
      <span
        className={cn(
          "whitespace-nowrap text-xs font-normal tabular-nums text-muted-foreground",
          className,
        )}
      >
        {time}
      </span>
    </>
  );
}
