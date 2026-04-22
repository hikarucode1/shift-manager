import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TutorHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ホーム</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          今週のシフトと未対応の申請を確認できます。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">今週の確定シフト</CardTitle>
            <CardDescription>まだ公開されていません</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            教室長が Excel をアップロードすると表示されます。
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">未対応の申請</CardTitle>
            <CardDescription>0 件</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            欠勤・交代申請の状況がここに表示されます。
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
