import { arrayContains, asc } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { AdminTutorsNav } from "@/components/admin-section-nav";
import { AdminManager } from "./admin-manager";

export default async function AdminAdminsPage() {
  const { profile } = await requireRole("admin");

  const rows = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      email: profiles.email,
      isActive: profiles.isActive,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(arrayContains(profiles.roles, ["admin"]))
    .orderBy(asc(profiles.displayName));

  const adminRows = rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    email: r.email,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  }));
  const activeCount = adminRows.filter((r) => r.isActive).length;

  return (
    <div className="space-y-6">
      <AdminTutorsNav />
      <div>
        <h1 className="text-2xl font-semibold">教室長管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          教室長の有効/無効を切り替えます。退職者は無効化で運用し、削除はできません
          (確定枠の責任所在を残すため)。最後の有効な教室長は無効化できません。
          教室長の新規追加は本 UI からは行えません — 既存の教室長 (DB 管理者)
          にお問い合わせください。
        </p>
      </div>
      <AdminManager
        admins={adminRows}
        currentAdminId={profile.id}
        activeCount={activeCount}
      />
    </div>
  );
}
