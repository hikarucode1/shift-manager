"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubjectFilterBar } from "@/components/subject-filter-bar";
import type { SubjectFilter as Filter } from "@/lib/tutor-subjects";

/** #349: 担当科目の表の絞り込み (URL の ?track= / ?subject= に持つ) */
export function SubjectFilter({ value }: { value: Filter }) {
  const router = useRouter();
  const params = useSearchParams();

  function change(next: Filter) {
    const q = new URLSearchParams(params);
    for (const [k, v] of [
      ["track", next.track],
      ["subject", next.subject],
    ] as const) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const qs = q.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <SubjectFilterBar value={value} onChange={change} className="print:hidden">
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={() => window.print()}
      >
        <Printer />
        印刷
      </Button>
    </SubjectFilterBar>
  );
}
