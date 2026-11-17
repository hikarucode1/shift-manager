"use server";

import {
  markAllReadFor,
  unreadCountFor,
  type UnreadCountResult,
} from "@/lib/notification-inbox";

/** 教室長のベルの未読数 (#344)。注意点は `unreadCountFor` を参照 (#168 #207) */
export async function getAdminUnreadCountAction(): Promise<UnreadCountResult> {
  return unreadCountFor("admin");
}

/** 教室長の通知一覧を開いたときに、教室長向けの未読を全件既読化する (#344) */
export async function markAllAdminReadAction(): Promise<void> {
  return markAllReadFor("admin");
}
