import type { MyApplication } from "@/lib/swaps";
import { OUTCOME_LABEL } from "@/lib/application-outcome";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTimeJst } from "@/lib/datetime";
import { shortDate } from "@/lib/week";

/**
 * 自分が関わった代講の結果 (#245 / #247)。応募したものと、教室長が代講者
 * として記録したもの (#215) の両方が入る。
 *
 * ⚠️ 見出しは「代講の**履歴**」。「記録」だと `rejected` / `withdrawn` の行まで
 * 覆ってしまい、**却下された募集が「代講の記録」の下に並ぶ**と、記録された
 * 代講が却下されたように読める (#251)。
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
        代講の履歴
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
                  variant={
                    a.outcome === "chosen" || a.outcome === "recorded"
                      ? "accent"
                      : "secondary"
                  }
                  className="text-[10px]"
                >
                  {OUTCOME_LABEL[a.outcome]}
                </Badge>
              </div>
              <p className="font-medium">
                {shortDate(a.date)}（{a.weekdayLabel}）{a.slotLabel}
                <span className="ml-2 font-normal text-muted-foreground">
                  {a.requesterName} さんのコマ
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
