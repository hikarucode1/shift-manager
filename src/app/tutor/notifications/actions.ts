"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { getUnreadCount, markRead } from "@/lib/notifications";

/** ベルの未読バッジ用 (NotificationBell がポーリングで呼ぶ) */
export async function getUnreadCountAction(): Promise<number> {
  const { profile } = await requireRole("tutor");
  return getUnreadCount(profile.id);
}

const MarkReadInput = z.array(z.string().uuid()).max(100);

/** 一覧表示した通知を既読化する (本人のもののみ。宛先検証は markRead 側) */
export async function markReadAction(input: unknown): Promise<void> {
  const { profile } = await requireRole("tutor");
  const parsed = MarkReadInput.safeParse(input);
  if (!parsed.success) return;
  await markRead(profile.id, parsed.data);
}
