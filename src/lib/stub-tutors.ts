/**
 * 座席表 CSV に出てくるが、まだ講師アカウントの無い名前を「ログイン未連携」
 * の講師として作るための判定 (取り込み画面のボタン)。
 *
 * 未連携の講師は auth_user_id が null で、メールは仮。あとで講師一覧の
 * 「ログイン連携（招待メール送信）」から本物のメールを紐付ける。
 */
export const MAX_STUB_TUTORS = 100;
export const MAX_TUTOR_NAME = 50;

/** 仮のメール。`.invalid` は実在しない予約 TLD (RFC 2606) なので誤送信しない */
export function stubEmail(id: string): string {
  return `stub-${id}@example.invalid`;
}

export type ExistingTutor = { id: string; displayName: string; isActive: boolean };

export type StubPlan =
  | {
      ok: true;
      /** 新しく作る名前 */
      toCreate: string[];
      /** 同じ名前の有効な講師がもういる (作らずにそちらへ対応付ける) */
      existing: { name: string; id: string }[];
    }
  | {
      ok: false;
      /** 同じ名前の講師が無効化されている。作ると表示名の一意制約に当たる */
      inactiveNames: string[];
    };

/**
 * 作る名前を決める。前後の空白を落として重複を除き、同名の講師 (無効化
 * された人も含む) がいるかを見る。講師の表示名は一意 (profiles_tutor_name_uniq)
 */
export function planStubTutors(
  names: readonly string[],
  tutors: readonly ExistingTutor[],
): StubPlan {
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ""))];
  const byName = new Map(tutors.map((t) => [t.displayName, t]));
  const inactiveNames = unique.filter((n) => byName.get(n)?.isActive === false);
  if (inactiveNames.length > 0) return { ok: false, inactiveNames };
  return {
    ok: true,
    toCreate: unique.filter((n) => !byName.has(n)),
    existing: unique
      .filter((n) => byName.has(n))
      .map((n) => ({ name: n, id: byName.get(n)!.id })),
  };
}
