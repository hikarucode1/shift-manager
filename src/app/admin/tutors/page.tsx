import { and, arrayContains, asc, count, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { AdminTutorsNav } from "@/components/admin-section-nav";
import { TutorManager } from "./tutor-manager";

export default async function AdminTutorsPage() {
  const { profile } = await requireRole("admin");

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

  const rows = tutors.map((t) => ({
    id: t.id,
    displayName: t.displayName,
    email: t.email,
    isActive: t.isActive,
    isAdmin: t.roles.includes("admin"),
    linked: t.authUserId !== null,
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
      />
    </div>
  );
}
