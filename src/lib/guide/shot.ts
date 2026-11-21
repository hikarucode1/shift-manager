import sizes from "./shots.json";
import type { GuideImage } from "./types";

/** 撮ってある画像の名前 (`public/guide/<名前>.webp`) */
export type ShotName = keyof typeof sizes;

/**
 * 手順に添える画像。大きさは `shots.json` から引く。
 *
 * 画像と `shots.json` は `scripts/guide/shots.cjs` が作る (手で書かない)。
 * 名前を間違えると型エラーになるので、画像の無い手順は書けない。
 */
export function shot(name: ShotName, alt: string): GuideImage {
  const s = sizes[name];
  return {
    src: `/guide/${name}.webp`,
    alt,
    width: s.w,
    height: s.h,
    displayWidth: Math.round(s.w / s.dpr),
  };
}
