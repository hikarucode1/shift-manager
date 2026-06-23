import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, landingPath } from "@/lib/auth";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profile = await getProfile(user.id);
  if (!profile) redirect("/login");

  redirect(landingPath(profile));
}
