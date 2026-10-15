import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// **v2 の下線の札と写真の格子**（板 MyPage・UserProfile）。
//
// - 札は字だけ・選んでいる札は真鍮の字と真鍮の下線（黒地の上なので真鍮）
// - 本人には「行きたい場所」「保存」も並べる。中身は別のページなので**タブではなくリンク**
//   （tablist の外。`role="tab"` のまま別ページへ飛ぶと矢印キーの作法と食い違う）
// - 写真の格子は3列・すき間 2px・縦長 4:5（広い画面でも4列にしない）

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../data/photos.json", () => ({ default: [] }));

const OWNER = "66666666-6666-4666-8666-666666666666";

import UserProfileClient from "../UserProfileClient";
import { TAB_ON, TAB_OFF } from "../../components/tabStyles";

const photo = (id: string) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id,
    category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01", published: true,
});
const MINE = [photo("a"), photo("b"), photo("c")];

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => MINE });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => MINE });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

const asOwner = () => mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });

describe("下線の札（v2）", () => {
    it("本人には「行きたい場所」「保存」がリンクで並ぶ（タブにしない）", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        const want = await screen.findByRole("link", { name: "行きたい場所" });
        expect(want.getAttribute("href")).toBe("/saved-spots");
        expect(screen.getByRole("link", { name: "保存" }).getAttribute("href")).toBe("/saves");
        // tablist の中に入れない＝タブは2つのまま
        const tablist = screen.getByRole("tablist");
        expect(tablist.contains(want)).toBe(false);
        expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["投稿", "年表"]);
        // 押せる高さ 44
        expect(want.style.height).toBe("44px");
    });

    it("他人・未ログインには出さない（本人の一覧しか取れない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await screen.findAllByRole("link", { name: /^a/ });
        expect(screen.queryByRole("link", { name: "行きたい場所" })).toBeNull();
        expect(screen.queryByRole("link", { name: "保存" })).toBeNull();
    });

    it("選んでいる札は真鍮の字と真鍮の下線、ほかは灰", () => {
        render(<UserProfileClient userId={OWNER} />);
        const [posts, timeline] = screen.getAllByRole("tab");
        // 色と下線は `tabStyles.ts` の定数（ホームのタブと同じ・下線は box-shadow の内側）
        expect(posts.className).toContain(TAB_ON);
        expect(posts.className).toContain("shadow-[inset_0_-2px_0_var(--color-accent)]");
        expect(timeline.className).toContain(TAB_OFF);
        expect(timeline.className).not.toContain("text-accent");
        expect(timeline.className).not.toContain("shadow-[");
        expect(posts.style.height).toBe("44px");
    });
});

describe("写真の格子（v2）", () => {
    it("3列・すき間 2px・縦長 4:5（広い画面でも4列にしない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        const panel = document.getElementById("profile-panel-posts")!;
        await screen.findAllByRole("link", { name: /^a/ });
        const grid = panel.querySelector(".grid") as HTMLElement;
        expect(grid.className).toContain("grid-cols-3");
        expect(grid.className).toContain("gap-[2px]");
        expect(grid.className).not.toMatch(/lg:grid-cols-4/);
        const tile = grid.firstElementChild as HTMLElement;
        expect(tile.style.paddingTop, "4:5 になっていない").toBe("125%");
    });
});
