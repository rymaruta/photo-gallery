import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

/**
 * **旅の一冊のページ**（`/users/trip?id=<userId>&p=<写真の id>`・iOS の `TripBookView`）。
 *
 * 表紙（写真が全面・白の眉ラベル「TRIP BOOK」・明朝の題・期間）→ 数（枚・撮影地・km）→
 * たどった場所 → 日ごとのページ。その人の**公開写真だけ**から、棚と同じ規則でまとめる。
 * 「この一冊を送る」は共有の口（`shareUrl`）。ブロックの関係なら出さない。
 */
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShare = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, userId: null as string | null, loading: false } }));

vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => auth.value }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../../lib/utils/api")>();
    return { ...actual, publicFetch: (...a: unknown[]) => mockPublicFetch(...a), userFetch: (...a: unknown[]) => mockUserFetch(...a) };
});
vi.mock("../../../../lib/utils/share", async (importActual) => {
    const actual = await importActual<typeof import("../../../../lib/utils/share")>();
    return { ...actual, shareUrl: (...a: unknown[]) => mockShare(...a) };
});
vi.mock("../../../data/photos.json", () => ({ default: [] }));

import TripBookClient from "../TripBookClient";

const OWNER = "owner-1";
const base = { userId: OWNER, category: "travel", tags: [], published: true, displayName: "旅人" };
const PHOTOS = [
    { ...base, id: "kz1", src: "https://cdn/1.jpg", date: "2026-09-12", location: "金沢", coords: { lat: 36.56, lng: 136.65 }, title: "ひがし茶屋街", likes: 2 },
    { ...base, id: "kz2", src: "https://cdn/2.jpg", date: "2026-09-12", location: "金沢", title: "兼六園", likes: 9 },
    { ...base, id: "fk", src: "https://cdn/3.jpg", date: "2026-09-14", location: "福井", coords: { lat: 36.06, lng: 136.22 }, description: "帰りに寄った。" },
    // 下書き・フォロワー限定は入れない
    { ...base, id: "draft", src: "https://cdn/4.jpg", date: "2026-09-13", location: "富山", published: false },
    { ...base, id: "fol", src: "https://cdn/5.jpg", date: "2026-09-13", location: "富山", audience: "followers" },
];

beforeEach(() => {
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => PHOTOS });
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ blockedIds: [] }) });
    mockShare.mockReset().mockResolvedValue("shared");
    auth.value = { isAuthenticated: false, userId: null, loading: false };
});

describe("旅の一冊", () => {
    it("表紙・数・たどった場所・日ごとのページ", async () => {
        render(<TripBookClient userId={OWNER} photoId="fk" />);
        const book = await screen.findByTestId("trip-book");
        // 題は明朝の h1（いちばん多い撮影地）。眉ラベルは写真の上なので白（真鍮ではない）
        const h1 = within(book).getByRole("heading", { level: 1 });
        expect(h1.textContent).toBe("金沢の旅");
        expect(h1.className).toContain("font-serif");
        const eyebrow = screen.getByTestId("trip-book-eyebrow");
        expect(eyebrow.textContent).toContain("TRIP BOOK");
        expect(eyebrow.className).not.toContain("text-accent");
        expect(book.textContent).toContain("2026.09.12 — 09.14 · 3日間");
        // 表紙はいいねがいちばん多い1枚
        expect(book.querySelector("header img")?.getAttribute("src")).toContain("2.jpg");
        // 数: 3枚・2撮影地・約 67km（下書き・限定は入らない）
        const stats = screen.getByTestId("trip-book-stats");
        // dl は札（dt）が先・数（dd）が後（見た目は逆順に描く）
        expect(stats.textContent).toMatch(/^枚3撮影地2移動（直線）6\dkm$/);
        expect(stats.querySelectorAll(".tabular-nums").length).toBeGreaterThanOrEqual(3);
        // たどった場所: 金沢 → 福井（読み上げは「1日目 金沢、3日目 福井」）
        const route = screen.getByTestId("trip-book-route");
        expect(within(route).getByRole("img").getAttribute("aria-label")).toBe("1日目 金沢、3日目 福井");
        // 日ごとの段: DAY 1（2枚）と DAY 3（1枚）。撮っていない日は段を作らない
        const days = screen.getAllByTestId("trip-book-day");
        expect(days.map((d) => d.querySelectorAll("article").length)).toEqual([2, 1]);
        expect(days[1].textContent).toContain("DAY 3 · 09.14");
        expect(days[1].textContent).toContain("帰りに寄った。");
        // 写真は写真のページへ
        expect(within(days[0]).getAllByRole("link")[0].getAttribute("href")).toContain("kz1");
    });

    it("「この一冊を送る」は共有の口に、題と期間と撮った人を渡す", async () => {
        render(<TripBookClient userId={OWNER} photoId="kz1" />);
        fireEvent.click(await screen.findByTestId("trip-book-share"));
        await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
        const [url, title, text] = mockShare.mock.calls[0] as string[];
        expect(url).toBe(window.location.href);
        expect(title).toBe("金沢の旅");
        expect(text).toBe("金沢の旅\n2026.09.12 — 09.14 · 3日間 · 3枚\n撮影: 旅人");
    });

    it("一冊に入らない写真（下書き）を指したら「見つかりません」", async () => {
        render(<TripBookClient userId={OWNER} photoId="draft" />);
        expect(await screen.findByTestId("trip-book-missing")).toBeTruthy();
        expect(screen.queryByTestId("trip-book")).toBeNull();
    });

    it("ブロックしている人の一冊は出さない", async () => {
        auth.value = { isAuthenticated: true, userId: "viewer", loading: false };
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ blockedIds: [OWNER] }) });
        render(<TripBookClient userId={OWNER} photoId="kz1" />);
        expect(await screen.findByTestId("trip-book-missing")).toBeTruthy();
    });
});
