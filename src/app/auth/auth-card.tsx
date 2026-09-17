import { Card, CardContent } from "@/components/ui/card";

/** /auth 配下の未ログイン向け画面の外枠。見た目は /login に揃えている */
export function AuthCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-[360px] rounded-xl shadow-sm">
        <CardContent className="space-y-6 p-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <div
              className="flex size-[46px] items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground"
              aria-hidden
            >
              S
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Shift Manager</p>
              <h1 className="text-lg font-semibold leading-tight">{title}</h1>
            </div>
          </div>
          {children}
        </CardContent>
      </Card>
    </main>
  );
}

export function AuthAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </div>
  );
}
