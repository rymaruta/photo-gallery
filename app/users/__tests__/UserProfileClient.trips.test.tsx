import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";

/**
 * **人のページの旅の記録と旅の一冊**（2026-10-21・iOS の `ProfileTravelRecord`・`ProfileTripsLine`・
 * `TripShelfList` を Web へ）。
 *
 * - 人のページにも「旅の記録」（写真をつないだ線と距離）を出す。**その人の公開写真だけ**で作り、
 *   押せない（撮影地マップは全員の写真なので、本人のページだけが押せる）
 * - 見出しに「旅の一冊」の札、タブに「旅」の棚。3日空くまでを1つの旅・2枚から一冊
 * - **ブロックの関係なら、どちらも出さない**
 * - 写真の格子は、スマホ（640px 未満）では端から端まで
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
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

import UserProfileClient from "../UserProfileClient";

const OWNER = "44444444-4444-4444-8444-444444444444";
const VIEWER = "55555555-5555-4555-8555-555555555555";
const session = (sub: string) => ({ getIdToken: () => ({ payload: { sub } }) });
const base = { userId: OWNER, category: "travel", tags: [], published: true };

/** パリ → バルセロナ（2日・約 830km）と、離れた日の東京・大阪（2日）。フォロワー限定は数えない */
const PHOTOS = [
    { ...base, id: "paris", src: "https://cdn/p.jpg", date: "2024-10-11", location: "パリ, フランス", coords: { lat: 48.86, lng: 2.35 }, createdAt: "2025-01-01T00:00:00Z" },
    { ...base, id: "bcn", src: "https://cdn/b.jpg", date: "2024-10-12", location: "バルセロナ, スペイン", coords: { lat: 41.39, lng: 2.17 }, createdAt: "2025-01-02T00:00:00Z" },
    { ...base, id: "tokyo", src: "https://cdn/t.jpg", date: "2026-04-29", location: "東京", createdAt: "2026-05-01T00:00:00Z" },
    { ...base, id: "osaka", src: "https://cdn/o.jpg", date: "2026-04-30", location: "東京", createdAt: "2026-05-02T00:00:00Z" },
    // 公開の口は絞った写真を返さないが、来ても数えない（見る人で数が変わらない）
    { ...base, id: "secret", src: "https://cdn/s.jpg", date: "2024-10-12", location: "ニューヨーク, アメリカ", coords: { lat: 40.71, lng: -74.0 }, audience: "followers" },
];

function respond(blocked: boolean) {
    mockUserFetch.mockReset().mockImplementation(async (path: string) => {
        if (path === "/user/blocks") return { ok: true, json: async () => ({ blockedIds: blocked ? [OWNER] : [] }) };
        return { ok: true, json: async () => [] };
    });
}

beforeEach(() => {
    respond(false);
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }) });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => PHOTOS });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

async function show(viewer: string | null) {
    if (viewer) mockGetCurrentSession.mockResolvedValue(session(viewer));
    render(<UserProfileClient userId={OWNER} />);
    await screen.findByText("5"); // 写真が届いた（投稿 5）
}

describe("人のページの旅の記録", () => {
    it("未ログインの人にも出す・公開写真だけで数える・押せない", async () => {
        await show(null);
        const block = await screen.findByTestId("travel-record");
        expect(block.tagName, "人のページで撮影地マップへのリンクになっている").not.toBe("A");
        // 読み上げは1回だけ（2026-10-21）: まとめた1文を読ませ、見た目の字は読ませない。
        // 名前つきの group にして中身も読ませていた頃は、同じ数と字を2回読んだ
        expect(block.getAttribute("aria-label")).toBeNull();
        const spoken = block.querySelector(".sr-only")!;
        expect(spoken.textContent).toContain("公開写真から");
        expect(spoken.textContent).not.toContain("撮影地マップを開く");
        const visible = [...block.children].filter((c) => c !== spoken);
        expect(visible.length).toBeGreaterThan(0);
        for (const c of visible) expect(c.getAttribute("aria-hidden")).toBe("true");
        // フォロワー限定（アメリカ）は国に入らない
        expect(screen.getByTestId("travel-countries").textContent).toBe("2か国・地域フランス・スペイン");
        // パリ → バルセロナの1区間（ニューヨークへの線は無い）
        expect(screen.getByTestId("travel-route").querySelectorAll("[data-seg]")).toHaveLength(1);
    });

    it("ブロックしている人のページには出さない", async () => {
        respond(true);
        await show(VIEWER);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/blocks"));
        await act(async () => { await Promise.resolve(); });
        await waitFor(() => expect(screen.queryByTestId("travel-record")).toBeNull());
        expect(screen.queryByTestId("profile-trips")).toBeNull();
    });
});

describe("旅の一冊", () => {
    it("見出しに一番新しい一冊の札と「すべての旅 · 2冊」・押すと旅のタブ", async () => {
        await show(null);
        const line = await screen.findByTestId("profile-trips");
        const card = within(line).getByTestId("profile-trip");
        expect(card.getAttribute("href")).toBe(`/users/trip?id=${OWNER}&p=tokyo`);
        expect(card.textContent).toContain("東京の旅");
        expect(card.textContent).toContain("2日間 · 2枚");
        fireEvent.click(within(line).getByTestId("profile-trips-all"));
        const tab = screen.getByRole("tab", { name: "旅" });
        expect(tab.getAttribute("aria-selected")).toBe("true");
        const shelf = within(screen.getByRole("tabpanel")).getByTestId("trip-shelf");
        // 新しい一冊が大きな表紙の札、2冊目からは行
        expect(within(shelf).getByTestId("trip-shelf-cover").textContent).toContain("東京の旅");
        const rows = within(shelf).getAllByTestId("trip-shelf-row");
        expect(rows).toHaveLength(1);
        // 題は短い形（「パリ, フランス」→「パリ」）・数字の1行
        expect(rows[0].textContent).toContain("パリの旅");
        expect(rows[0].textContent).toContain("2024.10.11 — 10.12 · 2日間 · 2枚");
        expect(rows[0].getAttribute("href")).toBe(`/users/trip?id=${OWNER}&p=paris`);
    });

    it("一冊も無い人は見出しに札を出さず、タブは説明だけ", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => [PHOTOS[0], PHOTOS[2]] });
        render(<UserProfileClient userId={OWNER} />);
        await screen.findByText("2");
        expect(screen.queryByTestId("profile-trips")).toBeNull();
        fireEvent.click(screen.getByRole("tab", { name: "旅" }));
        expect(screen.getByTestId("trip-shelf").textContent).toContain("まだ旅はありません");
    });
});

describe("写真の格子", () => {
    it("スマホでは端から端まで（外枠の左右を打ち消す）・PC は今まで", async () => {
        await show(null);
        const grid = screen.getByTestId("profile-grid");
        expect(grid.className).toContain("-mx-4");
        expect(grid.className).toContain("sm:mx-0");
    });
});
