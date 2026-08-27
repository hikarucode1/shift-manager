import type { MyApplication } from "@/lib/swaps";
import { OUTCOME_LABEL } from "@/lib/application-outcome";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTimeJst } from "@/lib/datetime";

/**
 * 自分が応募した募集の結果 (#245)。
 *
 * ⚠️ **行の種類で分岐しない。** 結果の判定は `application-outcome.ts` に
 * 集約してテストで固定してある。ここで `status === "approved" ? …` と書くと、
 * 「承認されたが自分は選ばれていない」を「決まりました」と出す事故になる。
 */
export function MyApplications({ applications }: { applications: MyApplication[] }) {
  if (applications.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">
        応募した募集の結果
      </h2>
      <div className="space-y-2">
        {applications.map((a) => (
          <Card key={a.id}>
            <CardContent className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {fmtDateTimeJst(a.decidedAt)}
                </span>
                <Badge
                  variant={a.outcome === "chosen" ? "accent" : "secondary"}
                  className="text-[10px]"
                >
                  {OUTCOME_LABEL[a.outcome]}
                </Badge>
              </div>
              <p className="font-medium">
                {a.date}（{a.weekdayLabel}）{a.slotLabel}
                <span className="ml-2 font-normal text-muted-foreground">
                  {a.requesterName} さんの募集
                </span>
              </p>
              {a.note && (
                <p className="text-xs text-muted-foreground">理由: {a.note}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
