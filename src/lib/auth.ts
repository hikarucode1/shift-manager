import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";

export type Role = "tutor" | "admin";

export type SessionProfile = {
  id: string;
  email: string;
  displayName: string;
  /** #111: 兼任対応で複数 role を持ちうる。判定は hasRole / landingPath を使う */
  roles: Role[];
  isActive: boolean;
};

/** profile が指定 role を持つか (兼任考慮) */
export function hasRole(
  profile: Pick<SessionProfile, "roles">,
  role: Role,
): boolean {
  return profile.roles.includes(role);
}

/** ログイン後 / リダイレクト先。admin を含むなら管理画面、それ以外は講師画面 */
export function landingPath(profile: Pick<SessionProfile, "roles">): string {
  return hasRole(profile, "admin") ? "/admin" : "/tutor";
}

/**
 * Supabase auth.users.id から内部プロフィールを解決する。
 * profiles.id ではなく profiles.auth_user_id で引く点に注意:
 * CSV 由来の stub プロフィール (auth 未連携) と本人ログインを分離した設計。
 */
export const getProfile = cache(
  async (authUserId: string): Promise<SessionProfile | null> => {
    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        roles: profiles.roles,
        isActive: profiles.isActive,
      })
      .from(profiles)
      .where(eq(profiles.authUserId, authUserId))
      .limit(1);

    return rows[0] ?? null;
  },
);

export async function requireSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profile = await getProfile(user.id);
  if (!profile || !profile.isActive) redirect("/login?reason=inactive");

  return { user, profile };
}

export async function requireRole(role: Role) {
  const session = await requireSession();
  if (!hasRole(session.profile, role)) {
    redirect(landingPath(session.profile));
  }
  return session;
}
