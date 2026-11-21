import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import {
  topicsForScreen,
  withFrom,
  type Guide,
  type GuideTopic,
} from "@/lib/guide";
import { cn } from "@/lib/utils";
import { GuideContact } from "./guide-contact";

/**
 * 「アプリの使い方」の一覧 (講師・教室長で共通)。やりたいことから手順を選ぶ。
 * ヘッダーの「？」から来たときは、開いていた画面に合う手順を一番上に出す
 */
export function GuideIndex({
  guide,
  from,
}: {
  guide: Guide;
  /** 「？」を押したときに開いていた画面 (検証済みのパス)。無ければ null */
  from: string | null;
}) {
  const here = topicsForScreen(guide, from);
  const wide = guide.role === "admin";

  return (
    <div className={cn("space-y-6", wide && "mx-auto max-w-4xl")}>
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <p className="text-xs text-primary-foreground/80">{guide.audience}</p>
        <h1 className="mt-0.5 text-xl font-bold">アプリの使い方</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          やりたいことを選ぶと、どの画面でどこを押すかを画像つきで見られます。
        </p>
      </section>

      {here.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-accent">
            <MapPin className="size-4" />
            いま開いていた画面の使い方
          </h2>
          <TopicList
            guide={guide}
            topics={here}
            from={from}
            className="ring-2 ring-accent/60"
          />
        </section>
      )}

      <div className={cn("space-y-6", wide && "sm:columns-2 sm:gap-6 sm:space-y-0")}>
        {guide.categories.map((category) => {
          const topics = guide.topics.filter((t) => t.category === category.id);
          if (topics.length === 0) return null;
          return (
            <section
              key={category.id}
              className={cn("space-y-2", wide && "break-inside-avoid sm:mb-6")}
            >
              <h2 className="text-sm font-semibold text-muted-foreground">
                {category.title}
              </h2>
              <TopicList guide={guide} topics={topics} from={from} />
            </section>
          );
        })}
      </div>

      <GuideContact guide={guide} from={from ?? `${guide.base}/guide`} />
    </div>
  );
}

function TopicList({
  guide,
  topics,
  from,
  className,
}: {
  guide: Guide;
  topics: GuideTopic[];
  from: string | null;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y rounded-xl border bg-card", className)}>
      {topics.map((topic) => (
        <li key={topic.slug}>
          <Link
            href={withFrom(`${guide.base}/guide/${topic.slug}`, from)}
            className="flex items-center gap-3 p-3 transition-colors hover:bg-muted/50"
          >
            <span className="flex-1">
              <span className="block text-sm font-medium">{topic.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {topic.summary}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
