import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SpotLink } from "@/lib/data/spotLink";

/**
 * 写真の詳細の「NEXT TRIP · 次の旅へ」の段。**持っているものだけ出す**・何も無ければ段ごと出さない。
 * 「行きたい」の中身（3つの状態）は `SaveSpotButton` のテストが見るので、ここでは置き換える。
 */
vi.mock("../../../components/SaveSpotButton", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    default: ({ slug, kind, variant }: { slug: string; kind?: string; variant?: string }) => (
        <button type="button" data-testid="wish" data-kind={kind} data-variant={variant}>{slug}</button>
    ),
}));

const PhotoTripSection = (await import("../PhotoTripSection")).default;

const GINZAN = { lat: 38.58, lng: 140.53 };
const SPOT: SpotLink = { slug: "ginzan-onsen", name: "銀山温泉", region: "山形県 尾花沢市", coords: GINZAN, cover: null, stage: "published" };

afterEach(() => { vi.useRealTimers(); });

describe("PhotoTripSection", () => {
    it("行きたい・経路・撮りに行くのどれも無ければ段ごと出さない", () => {
        const { container } = render(<PhotoTripSection spot={null} directionsTo={null} zone={null} inspiredPhotoId={null} locale="ja" />);
        expect(container.innerHTML).toBe("");
    });

    it("スポットを指す写真: 行きたい（スポットの鍵）と経路（Google マップ・新しいタブ・真鍮）", () => {
        render(<PhotoTripSection spot={SPOT} directionsTo={GINZAN} zone={null} inspiredPhotoId={null} locale="ja" />);
        expect(screen.getByText("NEXT TRIP · 次の旅へ")).toBeTruthy();
        const wish = screen.getByTestId("wish");
        expect(wish.textContent).toBe("ginzan-onsen");
        expect(wish.dataset.kind, "撮影スポットのページと同じ鍵（SPOT-…）で入れる").toBe("spot");
        const route = screen.getByTestId("photo-trip-directions");
        expect(route.getAttribute("href")).toBe("https://www.google.com/maps/dir/?api=1&destination=38.58,140.53");
        expect(route.getAttribute("target")).toBe("_blank");
        expect(route.getAttribute("rel")).toContain("noopener");
        expect(route.className.split(/\s+/), "外へ出るリンクは真鍮").toContain("text-accent");
        expect(route.className.split(/\s+/), "白の字と並べない").not.toContain("text-white");
        expect(route.getAttribute("aria-label")).toBe("銀山温泉への経路（Google マップ）");
    });

    it("スポットの無い写真には「行きたい」を出さない（経路だけ・1列）", () => {
        render(<PhotoTripSection spot={null} directionsTo={GINZAN} zone={null} inspiredPhotoId={null} locale="ja" />);
        expect(screen.queryByTestId("wish")).toBeNull();
        expect(screen.getByTestId("photo-trip-directions").parentElement?.className).toContain("grid-cols-1");
    });

    it("時計が分かれば、次のゴールデンアワーを出す（水和の後に計算する）", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-10T12:00:00+09:00"));
        render(<PhotoTripSection spot={SPOT} directionsTo={GINZAN} zone="Asia/Tokyo" inspiredPhotoId={null} locale="ja" />);
        const line = await screen.findByTestId("photo-trip-golden");
        expect(line.textContent).toContain("次のゴールデンアワー · 今日");
        expect(line.textContent).toContain("16:34–17:26");
    });

    it("時計が分からなければ、ゴールデンアワーの行を出さない（推測で時計を決めない）", () => {
        render(<PhotoTripSection spot={SPOT} directionsTo={GINZAN} zone={null} inspiredPhotoId={null} locale="ja" />);
        expect(screen.queryByTestId("photo-trip-golden")).toBeNull();
    });

    it("「この写真を見て撮りに行く」は投稿画面へ元の写真を渡す", () => {
        render(<PhotoTripSection spot={null} directionsTo={null} zone={null} inspiredPhotoId="p 1" locale="ja" />);
        const link = screen.getByTestId("photo-trip-inspired");
        expect(link.textContent).toContain("この写真を見て撮りに行く");
        expect(link.getAttribute("href")).toBe("/user/upload?inspiredBy=p%201");
    });
});
