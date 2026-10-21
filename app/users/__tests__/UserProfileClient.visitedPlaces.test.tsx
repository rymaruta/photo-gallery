import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// **他人のページの「訪れた場所」**（板 v2 UserProfile のチップ）。
//
// - 撮影地ページと同じ数え方（`collectEntries`）で多い順に3つ・残りは「ほか N か所」
// - 行き先のページ（`/location/*`）が無いチップはリンクにしない（ビルドのあとに初めて書いた撮影地は 404）
// - 本人のページには出さない（本人は「旅の記録」）
// - 押せる高さは 44

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

// ビルドに入っている写真（＝`/location/*` が在る撮影地）。「新しい町」の写真はビルドのあと
vi.mock("../../data/photo-index.json", () => ({
    default: { photoIds: ["k1", "k2", "k3", "n1", "n2", "z1", "o1"], userIds: [] },
}));

const OWNER = "77777777-7777-4777-8777-777777777777";

import UserProfileClient from "../UserProfileClient";

const at = (id: string, location: string) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id, location,
    category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01", published: true,
});
const PHOTOS = [
    at("k1", "京都"), at("k2", "京都"), at("k3", "京都"),
    at("n1", "奈良"), at("n2", "奈良"),
    at("new1", "新しい町"), at("new2", "新しい町"), at("new3", "新しい町"), at("new4", "新しい町"),
    at("z1", "金沢"), at("o1", "大阪"),
];

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => PHOTOS });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => PHOTOS });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

describe("訪れた場所のチップ", () => {
    it("多い順に3つ・残りは「ほか N か所」。数は撮影地ページと同じ", async () => {
        render(<UserProfileClient userId={OWNER} />);
        const section = await screen.findByTestId("visited-places");
        expect(section.querySelector("h2")?.textContent).toBe("訪れた場所");
        const items = Array.from(section.querySelectorAll("li")).map((li) => li.textContent);
        expect(items).toEqual(["新しい町4", "京都3", "奈良2", "ほか 2か所"]);
    });

    it("🔴 行き先のページが無い撮影地はリンクにしない（404 へ連れて行かない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        const section = await screen.findByTestId("visited-places");
        // チップの中だけを見る（同じ地名は「旅の一冊」の札にも出る・2026-10-21）
        expect(within(section).queryByRole("link", { name: /新しい町/ })).toBeNull();
        const kyoto = screen.getByRole("link", { name: "京都（3枚）" });
        expect(kyoto.getAttribute("href")).toBe(`/location/${encodeURIComponent("京都")}`);
        expect(kyoto.style.minHeight, "押せる高さが 44 に足りない").toBe("44px");
    });

    it("本人のページには出さない（本人は「旅の記録」）", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });
        render(<UserProfileClient userId={OWNER} />);
        await screen.findByRole("link", { name: "行きたい場所" });
        expect(screen.queryByTestId("visited-places")).toBeNull();
    });
});
