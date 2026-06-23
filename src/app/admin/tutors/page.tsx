import { arrayContains, asc } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { TutorManager } from "./tutor-manager";

export default async function AdminTutorsPage() {
  await requireRole("admin");

  const tutors = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      email: profiles.email,
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
    linked: t.authUserId !== null,
    createdAt: t.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">講師管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師の招待・氏名変更・有効/無効を行います。削除はできません（無効化のみ）。
        </p>
      </div>
      <TutorManager tutors={rows} />
    </div>
  );
}
