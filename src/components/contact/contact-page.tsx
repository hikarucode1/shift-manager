import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionProfile } from "@/lib/auth";
import { roleLabel, sanitizePagePath } from "@/lib/inquiry";
import { ContactForm } from "./contact-form";

/** 講師・教室長で共通のお問い合わせ画面の中身 (#320) */
export function ContactPage({
  profile,
  from,
}: {
  profile: SessionProfile;
  from: string | string[] | undefined;
}) {
  const pagePath = sanitizePagePath(typeof from === "string" ? from : null);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">お問い合わせ</CardTitle>
          <CardDescription>
            使い方で分からないことや、おかしな動きがあれば送ってください。開発者に届きます。シフトの相談は今までどおり教室長へお願いします。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContactForm
            pagePath={pagePath}
            senderLabel={`${profile.displayName}さん（${roleLabel(profile.roles)}）`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
