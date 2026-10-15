import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import type { SpotLink } from "@/lib/data/spotLink";

/**
 * 写真ページへの「NEXT TRIP · 次の旅へ」の配線。経路の行き先・撮りに行くを出す条件を、
 * 画面に渡った結果で見る（判断そのものは `lib/utils/__tests__/photoTrip.test.ts`）。
 */
const auth = vi.hoisted(() => ({ isAuthenticated: false, userId: null as string | null, loading: false }));
vi.mock("../../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: vi.fn(() => new Promise(() => undefined)),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const BASE = {
    id: "p1", src: "https://cdn.example.com/uploads/alice/a.webp", title: "朝の湖", userId: "alice",
    displayName: "アリス", location: "銀山温泉",
} as unknown as Photo;

beforeEach(() => {
    auth.isAuthenticated = false;
    auth.userId = null;
});

describe("写真ページ: NEXT TRIP · 次の旅へ", () => {
    it("正確な座標の写真: 経路はその座標へ", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, coords: { lat: 38.58, lng: 140.53 } } as Photo} />);
        const route = await screen.findByTestId("photo-trip-directions");
        expect(route.getAttribute("href")).toContain("destination=38.58,140.53");
    });

    it("おおよその座標（地名から引いた街の中心）には経路を出さない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, coords: { lat: 38.58, lng: 140.53 }, geoApprox: true } as Photo} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("photo-trip-directions")).toBeNull();
    });

    it("他人の写真には「この写真を見て撮りに行く」を出す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        const link = await screen.findByTestId("photo-trip-inspired");
        expect(link.getAttribute("href")).toBe("/user/upload?inspiredBy=p1");
    });

    it("公開範囲を絞った写真（フォロワーのみ）には「この写真を見て撮りに行く」を出さない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, audience: "followers" } as unknown as Photo} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("photo-trip-inspired")).toBeNull();
    });

    it("台帳のスポットが無い写真には、日本の中の正確な座標でも次のゴールデンアワーを出さない（時計を推測しない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, coords: { lat: 38.58, lng: 140.53 } } as Photo} />);
        await screen.findByTestId("photo-trip-directions");
        expect(screen.queryByTestId("photo-trip-golden")).toBeNull();
    });

    it("台帳のスポットの座標と時刻帯が引ければ、次のゴールデンアワーを出す", async () => {
        const spot: SpotLink = { slug: "ginzan-onsen", name: "銀山温泉", region: "山形県 尾花沢市", coords: { lat: 38.58, lng: 140.53 }, cover: null, stage: "published" };
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} spotLink={spot} spotTimeZone="Asia/Tokyo" />);
        expect((await screen.findByTestId("photo-trip-golden")).textContent).toContain("次のゴールデンアワー");
    });

    it("自分の写真には出さない", async () => {
        auth.isAuthenticated = true;
        auth.userId = "alice";
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("photo-trip-inspired")).toBeNull();
    });
});
