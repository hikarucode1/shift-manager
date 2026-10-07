import { describe, expect, it } from "vitest";
import {
  isResendable,
  isTutorVisible,
  matchesQuery,
  matchesStatus,
  matchesView,
  normalizeQuery,
} from "@/lib/tutor-list-filter";

const linked = {
  id: "t1",
  displayName: "田中 花子",
  email: "tanaka@example.com",
  isActive: true,
  linked: true,
  inviteStatus: "pending" as const,
};
const stub = {
  ...linked,
  id: "t2",
  displayName: "山本 美里",
  email: "yamamoto@example.com",
  linked: false,
  inviteStatus: null,
};

describe("isResendable", () => {
  it("有効で招待中のときだけ", () => {
    expect(isResendable(linked)).toBe(true);
    expect(isResendable({ ...linked, isActive: false })).toBe(false);
    expect(isResendable({ ...linked, inviteStatus: "accepted" })).toBe(false);
    expect(isResendable({ ...linked, inviteStatus: "unknown" })).toBe(false);
  });
});

describe("matchesStatus", () => {
  it("状態の絞り込み", () => {
    expect(matchesStatus(stub, "all")).toBe(true);
    expect(matchesStatus(linked, "linked")).toBe(true);
    expect(matchesStatus(stub, "linked")).toBe(false);
    expect(matchesStatus(linked, "pending")).toBe(true);
    expect(
      matchesStatus({ ...linked, inviteStatus: "accepted" }, "pending"),
    ).toBe(false);
    expect(matchesStatus(stub, "unlinked")).toBe(true);
    expect(matchesStatus(linked, "unlinked")).toBe(false);
  });
});

describe("matchesQuery", () => {
  it("氏名で当てる。空の検索は全員に当たる", () => {
    expect(matchesQuery(linked, "")).toBe(true);
    expect(matchesQuery(linked, "田中")).toBe(true);
    expect(matchesQuery(linked, "山本")).toBe(false);
  });

  it("メールで当てるのは連携済みだけ (未連携は画面でメールを隠している)", () => {
    expect(matchesQuery(linked, "tanaka@")).toBe(true);
    expect(matchesQuery(stub, "yamamoto@")).toBe(false);
  });
});

describe("isTutorVisible (#302)", () => {
  const opts = { statusFilter: "all" as const, query: "", editingId: null };

  it("ふだんは絞り込みと検索の両方に当たる行だけ", () => {
    expect(isTutorVisible(linked, { ...opts, statusFilter: "pending" })).toBe(
      true,
    );
    expect(isTutorVisible(stub, { ...opts, statusFilter: "pending" })).toBe(
      false,
    );
    expect(isTutorVisible(linked, { ...opts, query: "山本" })).toBe(false);
  });

  it("編集中の行は、読み直しで絞り込みから外れても出す (受け取り済みに変わった)", () => {
    const accepted = { ...linked, inviteStatus: "accepted" as const };
    expect(
      isTutorVisible(accepted, {
        ...opts,
        statusFilter: "pending",
        editingId: "t1",
      }),
    ).toBe(true);
  });

  it("編集中の行は、検索から外れても出す (未連携に変わってメールで当たらない / 氏名を変えた)", () => {
    const unlinked = { ...linked, linked: false, inviteStatus: null };
    expect(
      isTutorVisible(unlinked, {
        ...opts,
        statusFilter: "linked",
        query: "tanaka@",
        editingId: "t1",
      }),
    ).toBe(true);
    expect(
      isTutorVisible(
        { ...linked, displayName: "佐藤 花子" },
        { ...opts, query: "田中", editingId: "t1" },
      ),
    ).toBe(true);
  });

  it("編集中でない行は残さない", () => {
    const accepted = { ...linked, inviteStatus: "accepted" as const };
    expect(
      isTutorVisible(accepted, {
        ...opts,
        statusFilter: "pending",
        editingId: "t2",
      }),
    ).toBe(false);
  });
});

describe("matchesView (#302: 見るものを変えたとき編集を閉じるか)", () => {
  it("編集中の行がまだ当たるなら閉じない (1 文字打つたびに入力を消さない)", () => {
    expect(
      matchesView(linked, {
        statusFilter: "all",
        query: normalizeQuery(" 田 "),
      }),
    ).toBe(true);
  });

  it("当たらなくなるなら閉じる", () => {
    expect(matchesView(linked, { statusFilter: "unlinked", query: "" })).toBe(
      false,
    );
    expect(
      matchesView(linked, { statusFilter: "all", query: normalizeQuery("山") }),
    ).toBe(false);
  });
});
