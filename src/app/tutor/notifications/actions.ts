"use server";

import {
  markAllReadFor,
  unreadCountFor,
  type UnreadCountResult,
} from "@/lib/notification-inbox";

/** 講師のベルの未読数。注意点は `unreadCountFor` を参照 (#168 #207) */
export async function getUnreadCountAction(): Promise<UnreadCountResult> {
  return unreadCountFor("tutor");
}

/** 講師の通知一覧を開いたときに、講師向けの未読を全件既読化する */
export async function markAllReadAction(): Promise<void> {
  return markAllReadFor("tutor");
}
