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
  role: Role;
  isActive: boolean;
};

export const getProfile = cache(
  async (userId: string): Promise<SessionProfile | null> => {
    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        role: profiles.role,
        isActive: profiles.isActive,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
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
  if (session.profile.role !== role) {
    redirect(session.profile.role === "admin" ? "/admin" : "/tutor");
  }
  return session;
}
