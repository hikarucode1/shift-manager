"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { db } from "@/db/client";
import { absenceRequests } from "@/db/schema";

type ActionResult = { ok: true } | { ok: false; error: string };

const CancelApprovedAbsenceInput = z.object({
  // zod 既定の英語メッセージ ("Invalid UUID") が画面に出るのを防ぐ
  id: z.string().uuid("対象が正しく指定されていません。"),
  reason: z
    .string()
    .trim()
    .min(1, "取り消し理由を入力してください。")
    .max(500, "取り消し理由は 500 文字以内で入力してください。"),
});

/**
 * 承認済みの欠勤を取り消す (#219)。
 *
 * ⚠️ **これが無いと `approved` は終端状態**だった。`decideAbsenceRequest` /
 * `cancelAbsenceRequest` はどちらも `status = 'pending'` 条件付きで、approved
 * から出る経路は交代承認時の自動失効だけ。交代申請が無ければ発火しないので、
 * 「先週の欠勤を誤って承認した」場合に週次シフト表の取り消し線を消す手段が
 * アプリに存在しなかった。
 *
 * ⚠️ 日付・コマのガードは付けない。#178 / #211 / #213 と同じ結論で、これは
 * 「改竄」ではなく**実態の記録**。むしろ過去のコマこそ是正したい。ガードの
 * 代わりに**理由を必須**にし、`decided_by` / `decided_at` を上書きして
 * 「誰がいつ取り消したか」を残す。
 *
 * ⚠️ `weekly_shifts` は触らない。欠勤の承認は `absence_requests.status` しか
 * 変えず、表示側 (`getApprovedAbsenceKeysAll`) が status を見ているため、
 * status を戻すだけで表示も戻る。`cancelApprovedSwap` (#213) が担当の
 * 付け替えを確認する必要があったのに対し、こちらが単純なのはこの差による。
 *
 * ⚠️ `pending` へは戻さない。理由は監査ではなく**運用**:
 *   1. `getPendingAbsenceRequests` の未対応キューに戻り、講師が出していない
 *      申請を教室長が再び処理することになる
 *   2. 部分 unique `absence_requests_active_uniq` は `pending` / `approved` が
 *      対象なので、`pending` に戻すと講師の出し直しを塞いだままになる
 *   `cancelled` にすれば両方とも解ける。
 *
 * ⚠️ **`cancelled` 行を見ても「承認を経由したか」は判別できない**。`cancelled`
 * には講師の自己取り下げ (`cancelAbsenceRequest`) と交代成立の自動失効
 * (`swap-actions.ts`) からも到達し、どちらも `decided_by` を触らないため。
 * 承認履歴が要るなら別テーブルが要る (現状そこまでの要求は無い)。
 */
export async function cancelApprovedAbsence(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = CancelApprovedAbsenceInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id, reason } = parsed.data;

  const updated = await db
    .update(absenceRequests)
    .set({
      status: "cancelled",
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: reason,
      updatedAt: new Date(),
    })
    // approved 以外 (既に取り消し済み / 却下済み) には打たせない。
    // 二重送信でも 2 回目は 0 行になり、下でその旨を返す
    .where(
      and(eq(absenceRequests.id, id), eq(absenceRequests.status, "approved")),
    )
    .returning({
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
    });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "取り消せませんでした（既に対応済みの可能性があります）。",
    };
  }

  // ⚠️ 承認を通知しているのに取り消しが無音だと、**講師は休むつもりのまま
  // 来ない**。承認と同じ absence_result で送る
  await notify([updated[0].tutorId], {
    type: "absence_result",
    title: "欠勤の承認が取り消されました",
    body: `対象日: ${updated[0].date} ／ ${reason}`,
    href: "/tutor/absences",
  });

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  return { ok: true };
}
