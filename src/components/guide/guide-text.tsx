import { Fragment } from "react";

/**
 * 使い方の文。「」で囲んだ画面・ボタンの名前を太字にする
 * (手順を流し読みしても、押すところが目に入るように)
 */
export function GuideText({ text }: { text: string }) {
  const parts = text.split(/(「[^」]+」)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("「") ? (
          <strong key={i} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
