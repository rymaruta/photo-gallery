import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * **旅の記録**（v2 の板 MyPage・案 H1「星図」。iOS の `TravelRecordView` と同じ形）。
 *
 * 以前は「総移動距離」の1行だった。いまは真鍮の眉ラベル「旅の記録」・写真をつないだ距離・
 * 訪れた国・地域・写真をつないだ線。押した先は撮影地マップ（`/map`）＝**全員の写真**なので、
 * 他人のページで押せると「この人の旅の続き」に見えて別のものへ連れて行く——
 * **押せるのは本人のページだけ**（2026-10-21 から人のページにも出す。押せない塊として）。
 *
 * あわせて「数字の行」の字の大きさが2つのファイルでずれないことも見る
 * ——投稿は `UserProfileClient`、フォロワー／フォロー中は `FollowButton` が
 * 描くので、片方だけ直すと同じ行の中で数字の大きさが割れる。
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
const session = (sub: string) => ({ getIdToken: () => ({ payload: { sub } }) });

/** 東京 → 大阪。約 400km なので「2枚以上・1km 以上」の条件を満たす */
const GEO = [
    { id: "tokyo", userId: OWNER, src: "https://cdn/t.jpg", title: "東京", category: "travel", tags: [],
        date: "2024-11-01", createdAt: "2026-01-01T00:00:00.000Z", published: true, coords: { lat: 35.68, lng: 139.77 },
        location: "東京, 日本" },
    { id: "osaka", userId: OWNER, src: "https://cdn/o.jpg", title: "大阪", category: "travel", tags: [],
        date: "2024-11-02", createdAt: "2026-01-02T00:00:00.000Z", published: true, coords: { lat: 34.69, lng: 135.50 },
        location: "大阪" },
];

beforeEach(() => {
    // 本人のときは自分の一覧（`userFetch`）から、他人のときは公開一覧
    // （`publicFetch`）から写真が来る。距離はどちらの経路でも出る
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => GEO });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => GEO });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

async function show(viewer: string | null) {
    if (viewer) mockGetCurrentSession.mockResolvedValue(session(viewer));
    render(<UserProfileClient userId={OWNER} />);
    // 写真が届いたことを数字の行で待つ（「…」のあいだは数えていない）
    await screen.findByText("2");
}

describe("旅の記録", () => {
    it("本人のページでは、眉ラベル・距離・国・線を出し、撮影地マップへのリンクになる", async () => {
        await show(OWNER);
        const block = await screen.findByTestId("travel-record");

        expect(block.tagName, "リンクになっていない").toBe("A");
        expect(block.getAttribute("href")).toBe("/map");
        // 名前に数え方と行き先を入れる（中の字は読ませない）
        expect(block.getAttribute("aria-label")).toMatch(/^旅の記録。写真をつないだ距離 \d[\d,]* キロメートル。訪れた国・地域 1、日本。撮影地マップを開く$/);
        expect(block.textContent).toContain("旅の記録");
        expect(block.textContent, "一番古い写真の年が無い").toContain("2024 年から");
        expect(screen.getByTestId("travel-distance").textContent).toMatch(/^\d[\d,]*km写真をつないだ距離$/);
        // 国は撮影地に国名が書かれた写真だけ（「大阪」からは日本を当てない＝1のまま）
        expect(screen.getByTestId("travel-countries").textContent).toBe("1か国・地域日本");
        // 線は区間の数だけ（東京 → 大阪の1本）
        const route = screen.getByTestId("travel-route");
        expect(route.getAttribute("aria-hidden")).toBe("true");
        expect(route.querySelectorAll("[data-seg]")).toHaveLength(1);
    });

    it("距離の数字は等幅・数の段と同じ太さ（semibold）、km は小さく灰", async () => {
        await show(OWNER);
        const value = (await screen.findByTestId("travel-distance")).querySelector(".tabular-nums") as HTMLElement;
        expect(value, "等幅数字になっていない").toBeTruthy();
        expect(value.style.fontWeight).toBe("600");
        const km = value.nextElementSibling as HTMLElement;
        expect(km.textContent).toBe("km");
        expect(km.className).toContain("text-white/60");
    });

    // 2026-10-21: 人のページにも出す（iOS の `ProfileTravelRecord`）。ただし押せない
    // ——押した先の撮影地マップは全員の写真で、「この人の旅の続き」に見えて別のものへ連れて行く
    // （公開写真だけで数えること・ブロックの関係なら出さないことは `UserProfileClient.trips.test.tsx`）
    it("他人のページにも出すが、全員の地図へは連れて行かない（押せない）", async () => {
        await show("55555555-5555-4555-8555-555555555555");
        const block = await screen.findByTestId("travel-record");
        expect(block.tagName).not.toBe("A");
        expect(screen.queryByRole("link", { name: /撮影地マップを開く/ })).toBeNull();
    });

    it("未ログインでも同じ（出すが押せない）", async () => {
        await show(null);
        const block = await screen.findByTestId("travel-record");
        expect(block.tagName).not.toBe("A");
        expect(block.querySelector("a")).toBeNull();
    });
});

// **線の引き方もモックに合わせた。** 数字の行は「下に1本」だけで上には無い。
// 元に戻す変異が、字の大きさのテストでは素通りする
describe("線の引き方", () => {
    it("数字の行の上に線を引かない", async () => {
        await show(OWNER);
        const lab = screen.getAllByText("投稿").find((e) => e.style.fontSize)!;
        const row = lab.parentElement!.parentElement!;
        expect(row.className, "下に1本ではない").toContain("border-b");
        expect(row.className, "上にも線が戻っている").not.toMatch(/border-y|border-t/);
    });
});

describe("数字の行の字の大きさ", () => {
    /** ラベルの span（インラインの fontSize を持つ方）と、その直前の数字の span */
    const sizesOf = (label: string) => {
        const lab = screen.getAllByText(label).find((e) => e.style.fontSize);
        expect(lab, `${label} のラベルが見つからない`).toBeTruthy();
        const num = lab!.previousElementSibling as HTMLElement | null;
        expect(num, `${label} の数字が見つからない`).toBeTruthy();
        return { label: lab!.style.fontSize, number: num!.style.fontSize };
    };

    // **2つのファイルが同じ数字を持たないように `statCellStyle.ts` から読む。**
    // 片方だけ直すと、同じ行の中で「182」と「386」の大きさが違って見える
    it("投稿とフォロワーが同じ大きさ（別のファイルが描いている）", async () => {
        await show(OWNER);

        const posts = sizesOf("投稿");
        const followers = sizesOf("フォロワー");
        expect(followers, "同じ行なのに字の大きさが割れている").toEqual(posts);
        expect(posts.number, "数字が小さいまま（モックの実測は 20px）").toBe("20px");
        // 名前は iOS の `ProfileStat` の 12（2026-10-30 束 0b C14・以前はモック実測の 13）
        expect(posts.label).toBe("12px");
    });
});
