import { requireRole } from "@/lib/auth";
import { fetchActiveTutors } from "@/lib/upload-commit";
import { UploadWizard } from "./upload-wizard";

export default async function AdminUploadsPage() {
  // #188: 他の admin/tutor 全 17 ページと同じく page 自身でも認可する。
  // layout だけに依存させない (layout が fallback を返す経路では page の
  // 出力が RSC ペイロードに載って配信されるため、layout は認可の境界に
  // ならない。ここは講師の氏名一覧を返すので多重防御が要る)。
  await requireRole("admin");

  const tutors = await fetchActiveTutors();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">座席表 CSV アップロード</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          1週間分の座席表 CSV (Shift_JIS) を取り込み、講師ごとのシフトとして公開します。
        </p>
      </div>
      <UploadWizard tutors={tutors} />
    </div>
  );
}
