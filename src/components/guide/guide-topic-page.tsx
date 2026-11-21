import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Lightbulb,
  TriangleAlert,
} from "lucide-react";
import {
  findTopic,
  withFrom,
  type Guide,
  type GuideImage,
  type GuideNote,
  type GuideSection,
  type GuideTopic,
} from "@/lib/guide";
import { cn } from "@/lib/utils";
import { GuideContact } from "./guide-contact";
import { GuideText } from "./guide-text";

/** 文章の横幅の上限。広い画面でも 1 行が長くなりすぎないようにする */
const TEXT_WIDTH = "max-w-3xl";

/** 「アプリの使い方」の 1 トピック (やりたいこと 1 つ分の手順) */
export function GuideTopicPage({
  guide,
  topic,
  from,
}: {
  guide: Guide;
  topic: GuideTopic;
  /** 一覧から持ち回っている「元の画面」。無ければ null */
  from: string | null;
}) {
  const wide = guide.role === "admin";
  const related = (topic.related ?? [])
    .map((slug) => findTopic(guide, slug))
    .filter((t): t is GuideTopic => t !== null);

  return (
    // 教室長の画面の画像は横に広いので、画像だけは広く出す。文章は読みやすい
    // 幅で止める (TEXT_WIDTH)
    <article className={cn("space-y-6", wide && "mx-auto max-w-5xl")}>
      <Link
        href={withFrom(`${guide.base}/guide`, from)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        使い方の一覧へ
      </Link>

      <header className={cn("space-y-2", TEXT_WIDTH)}>
        <h1 className="text-xl font-bold">{topic.title}</h1>
        <p className="text-sm text-muted-foreground">{topic.summary}</p>
        {topic.open && (
          <Link
            href={topic.open.href}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {topic.open.label}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </header>

      {topic.sections.map((section, i) => (
        <Section key={i} section={section} />
      ))}

      {related.length > 0 && (
        <section className={cn("space-y-2", TEXT_WIDTH)}>
          <h2 className="text-sm font-semibold text-muted-foreground">
            あわせて見る
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {related.map((t) => (
              <li key={t.slug}>
                <Link
                  href={withFrom(`${guide.base}/guide/${t.slug}`, from)}
                  className="flex items-center gap-3 p-3 text-sm font-medium transition-colors hover:bg-muted/50"
                >
                  <span className="flex-1">{t.title}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={TEXT_WIDTH}>
        <GuideContact
          guide={guide}
          from={from ?? `${guide.base}/guide/${topic.slug}`}
        />
      </div>
    </article>
  );
}

function Section({ section }: { section: GuideSection }) {
  return (
    <section className="space-y-4">
      {section.heading && (
        // 左の帯は背景色で描く (globals.css の `* { border-color }` が勝つので、
        // border-l-accent では色が付かない)
        <h2 className="relative pl-3 text-base font-semibold before:absolute before:inset-y-0.5 before:left-0 before:w-1 before:rounded-full before:bg-accent">
          {section.heading}
        </h2>
      )}
      {section.intro && (
        <p
          className={cn(
            "text-sm leading-relaxed text-muted-foreground",
            TEXT_WIDTH,
          )}
        >
          <GuideText text={section.intro} />
        </p>
      )}
      {section.image && <Shot image={section.image} />}
      <ol className="space-y-5">
        {section.steps.map((step, i) => (
          <li key={i} className="space-y-2.5">
            <div className={cn("flex gap-3", TEXT_WIDTH)}>
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                <p className="text-[15px] leading-relaxed">
                  <span className="sr-only">手順 {i + 1}: </span>
                  <GuideText text={step.text} />
                </p>
                {step.detail && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <GuideText text={step.detail} />
                  </p>
                )}
              </div>
            </div>
            {/* 画像は番号の列に入れず、横幅いっぱいに出す (スマホで小さく
                ならないように)。広い画面では文章にそろえて字下げする */}
            {step.image && (
              <div className="sm:pl-10">
                <Shot image={step.image} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {section.notes && section.notes.length > 0 && (
        <div className={cn("space-y-2", TEXT_WIDTH)}>
          {section.notes.map((note, i) => (
            <Note key={i} note={note} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 画面の画像。PC のブラウザでは、押すと元の大きさで開く (小さくて読めない
 * とき用)。
 *
 * ⚠️ ホーム画面に追加したアプリでは開かない (`standalone:pointer-events-none`)。
 * タブも「戻る」も無いので、画像を開いたまま戻れなくなる (2026/11/21、月の
 * スケジュールの PDF で本人が踏んだのと同じ)。念のためスマホ・タブレットでも
 * 開かない (`touch:`)。指で拡大してもらう。
 *
 * あらかじめ WebP に縮めた静的ファイルなので、next/image は通さない
 * (変換の回数に上限があるうえ、ここでは得るものが無い)
 */
function Shot({ image }: { image: GuideImage }) {
  return (
    <a
      href={image.src}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-fit max-w-full overflow-hidden rounded-lg border bg-muted/40 shadow-sm standalone:pointer-events-none touch:pointer-events-none"
      style={{ maxWidth: image.displayWidth }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        className="h-auto w-full"
      />
    </a>
  );
}

function Note({ note }: { note: GuideNote }) {
  const caution = note.kind === "caution";
  const Icon = caution ? TriangleAlert : Lightbulb;
  return (
    <p
      className={cn(
        "flex gap-2 rounded-lg p-3 text-sm leading-relaxed",
        caution ? "bg-accent/10" : "bg-muted",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          caution ? "text-accent" : "text-muted-foreground",
        )}
      />
      <span>
        <span className="sr-only">{caution ? "注意: " : "ポイント: "}</span>
        <GuideText text={note.text} />
      </span>
    </p>
  );
}
