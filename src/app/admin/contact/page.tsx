import { requireRole } from "@/lib/auth";
import { ContactPage } from "@/components/contact/contact-page";

export default async function AdminContactPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { profile } = await requireRole("admin");
  const { from } = await searchParams;
  return <ContactPage profile={profile} from={from} />;
}
