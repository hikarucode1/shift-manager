import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          今週の稼働状況・未対応の申請をひと目で確認できます。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">アクティブ講師</CardTitle>
            <CardDescription>—</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            有効な講師の人数を表示します。
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">今週のシフト</CardTitle>
            <CardDescription>未公開</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Excel をアップロードすると公開できます。
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">未対応の申請</CardTitle>
            <CardDescription>0 件</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            欠勤・交代申請の一覧はここから。
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
