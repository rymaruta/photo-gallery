import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * **旅の実績の行**（最終版モック `docs/mockups/04-mypage.jpg` の3番）。
 *
 * モックは「訪れた国・地域 ｜ 総移動距離 ›」の2枠だが、訪れた国は持っていない
 * ので総移動距離の1枠だけ出す。`›` はモックがマイページなので付いているが、
 * このサイトで押した先に在るのは撮影地マップ（`/map`）＝**全員の写真**。
 * 他人のページに置くと「この人の旅の続き」に見えて別のものへ連れて行くので、
 * **本人のページだけ**リンクにする。
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
        date: "2024-11-01", createdAt: "2026-01-01T00:00:00.000Z", published: true, coords: { lat: 35.68, lng: 139.77 } },
    { id: "osaka", userId: OWNER, src: "https://cdn/o.jpg", title: "大阪", category: "travel", tags: [],
        date: "2024-11-02", createdAt: "2026-01-02T00:00:00.000Z", published: true, coords: { lat: 34.69, lng: 135.50 } },
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
    return await screen.findByTitle("旅した総移動距離");
}

describe("旅の実績の行", () => {
    it("本人のページでは、撮影地マップへのリンクになる", async () => {
        const row = await show(OWNER);

        expect(row.tagName, "リンクになっていない（矢印だけ出すと押せない飾りになる）").toBe("A");
        expect(row.getAttribute("href")).toBe("/map");
        expect(row.getAttribute("aria-label"), "行き先を名乗っていない").toBe("撮影地マップを開く");
        // 距離そのものは今までどおり出る
        expect(row.textContent).toMatch(/総移動距離/);
        expect(row.textContent).toMatch(/km/);
    });

    it("他人のページでは、押せる形にしない", async () => {
        const row = await show("55555555-5555-4555-8555-555555555555");

        expect(row.tagName, "他人のページから全員の地図へ連れて行っている").not.toBe("A");
        expect(screen.queryByRole("link", { name: "撮影地マップを開く" })).toBeNull();
        // 数字は本人と同じように出る（隠すのは押せる形だけ）
        expect(row.textContent).toMatch(/総移動距離/);
    });

    it("未ログインでも、押せる形にしない", async () => {
        const row = await show(null);
        expect(row.tagName).not.toBe("A");
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
        expect(posts.label).toBe("13px");
    });
});
