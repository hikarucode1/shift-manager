import { and, arrayContains, asc, count, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { AdminTutorsNav } from "@/components/admin-section-nav";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  collectAllPages,
  inviteStatusOf,
  type InviteStatus,
} from "@/lib/invite-resend";
import { TutorManager } from "./tutor-manager";

/**
 * 招待を受け取ったか (#265) は auth.users にしか無いので、一覧を開くたびに
 * 認証 API から読む。profiles に写すと二重管理になりずれる。
 * 読めなかったときは null を返し、一覧は「状態不明」で表示を続ける
 * (再送ボタンは出し、可否は resendInvite がサーバーで判定する)。
 */
async function loadInviteStatuses(): Promise<Map<string, InviteStatus> | null> {
  try {
    const supabase = createAdminClient();
    // 終わりの判定は collectAllPages (空のページで止める。#271)
    const users = await collectAllPages(async (page) => {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) {
        console.error("AdminTutorsPage: listUsers failed:", error.message);
        return null;
      }
      return data.users;
    });
    if (users === null) return null;
    return new Map(users.map((u) => [u.id, inviteStatusOf(u)]));
  } catch (e) {
    console.error("AdminTutorsPage: listUsers threw", e);
    return null;
  }
}

export default async function AdminTutorsPage() {
  const { profile } = await requireRole("admin");

  // 認証 API の読み込みは DB と独立なので、最初に始めて DB のクエリと並べる
  // (#271。以前は有効な教室長数のクエリを待ってから始めていた)
  const inviteStatusesPromise = loadInviteStatuses();

  // 兼任者 (admin かつ tutor) が「最後の有効な教室長」のとき、講師一覧からの
  // 無効化を UI 側でも事前 disable するため、有効な教室長数を数える。
  // (サーバー側は setProfileActive に集約されたガードで経路不問に保護済み)
  const [{ value: activeAdminCount }] = await db
    .select({ value: count() })
    .from(profiles)
    .where(
      and(arrayContains(profiles.roles, ["admin"]), eq(profiles.isActive, true)),
    );

  const tutors = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      email: profiles.email,
      roles: profiles.roles,
      isActive: profiles.isActive,
      authUserId: profiles.authUserId,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(arrayContains(profiles.roles, ["tutor"]))
    .orderBy(asc(profiles.displayName));

  const inviteStatuses = await inviteStatusesPromise;

  const rows = tutors.map((t) => ({
    id: t.id,
    displayName: t.displayName,
    email: t.email,
    isActive: t.isActive,
    isAdmin: t.roles.includes("admin"),
    linked: t.authUserId !== null,
    inviteStatus:
      t.authUserId === null
        ? null
        : (inviteStatuses?.get(t.authUserId) ?? "unknown"),
    createdAt: t.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <AdminTutorsNav />
      <div>
        <h1 className="text-2xl font-semibold">講師管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師の招待・氏名変更・有効/無効を行います。削除はできません（無効化のみ）。
        </p>
      </div>
      <TutorManager
        tutors={rows}
        currentProfileId={profile.id}
        activeAdminCount={activeAdminCount}
        inviteStatusLoaded={inviteStatuses !== null}
      />
    </div>
  );
}
