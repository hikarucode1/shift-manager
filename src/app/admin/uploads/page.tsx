import { fetchActiveTutors } from "@/lib/upload-commit";
import { UploadWizard } from "./upload-wizard";

export default async function AdminUploadsPage() {
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
