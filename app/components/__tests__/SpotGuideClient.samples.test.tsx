import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import type { SpotSample } from "@/lib/data/spotSamples";

/**
 * **撮影地ページの作例（Wikimedia Commons より）。**
 *
 * 🔴 1枚ごとに、写真のすぐ下へ作者・ライセンス（文面へのリンク）・出典（Commons のページへの
 * リンク）が必ず出る。CC BY・CC BY-SA の表示条件で、欠けたら使えない。
 */
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) }) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_kinkaku0001", slug: "kinkakuji", name: "鹿苑寺（金閣寺）", summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "京都府", city: "京都市" }, coords: { lat: 35.04, lng: 135.73 },
    status: "published", verifiedBy: "運営", verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
};

const SAMPLES: SpotSample[] = [
    {
        src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/1280px-A.jpg", width: 1280, height: 853,
        author: "Romain Pontida", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:A.jpg", title: "Kinkaku-ji 金閣寺",
    },
    {
        src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/B.jpg/1280px-B.jpg", width: 1280, height: 960,
        author: "作者不明", license: "Public domain",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:B.jpg", title: "B",
    },
];

const view = (samples?: SpotSample[]) => render(
    <ToastProvider>
        <SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} samples={samples} />
    </ToastProvider>,
);

describe("作例（Wikimedia Commons より）", () => {
    it("見出しで Wikimedia Commons からと名乗り、利用者の投稿とは別だと書く", () => {
        view(SAMPLES);
        expect(screen.getByRole("heading", { name: "作例（Wikimedia Commons より）" })).toBeTruthy();
        expect(screen.getByTestId("spot-samples").textContent).toContain("撮影者はこのサイトの利用者ではありません");
        // 投稿の節は0枚のまま（作例を投稿の枚数に数えない）
        expect(screen.getByRole("heading", { name: "この場所の写真（0）" })).toBeTruthy();
    });

    it("🔴 1枚ごとに作者・ライセンス（文面へ）・出典（Commons のページへ）が写真のすぐ下に出る", () => {
        view(SAMPLES);
        const figures = screen.getByTestId("spot-samples").querySelectorAll("figure");
        expect(figures).toHaveLength(2);
        const [a, b] = Array.from(figures);

        const capA = within(a as HTMLElement).getByTestId("spot-sample-credit");
        expect(capA.textContent).toBe("Kinkaku-ji 金閣寺 / 写真: Romain Pontida / CC BY-SA 2.0 / Wikimedia Commons");
        // 題（TASL の T）を出す
        expect(capA.querySelector("cite")?.textContent).toBe("Kinkaku-ji 金閣寺");
        expect(within(capA).getByRole("link", { name: "CC BY-SA 2.0" }).getAttribute("href")).toBe("https://creativecommons.org/licenses/by-sa/2.0");
        expect(within(capA).getByRole("link", { name: "CC BY-SA 2.0" }).getAttribute("rel")).toContain("license");
        expect(within(capA).getByRole("link", { name: "Wikimedia Commons" }).getAttribute("href")).toBe("https://commons.wikimedia.org/wiki/File:A.jpg");

        // パブリックドメイン（文面の URL が無い）は名前を文字で出し、出典のリンクは必ず出す
        const capB = within(b as HTMLElement).getByTestId("spot-sample-credit");
        expect(capB.textContent).toBe("B / 写真: 作者不明 / Public domain / Wikimedia Commons");
        expect(within(capB).queryByRole("link", { name: "Public domain" })).toBeNull();
        expect(within(capB).getByRole("link", { name: "Wikimedia Commons" }).getAttribute("href")).toBe("https://commons.wikimedia.org/wiki/File:B.jpg");
    });

    it("画像は Commons のサムネイル（縮小版の srcset つき・切り抜かない・遅れて読む）", () => {
        view(SAMPLES);
        const img = screen.getByTestId("spot-samples").querySelector("img")!;
        expect(img.getAttribute("src")).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg");
        expect(img.getAttribute("srcset")).toContain("1280px-A.jpg 1280w");
        expect(img.getAttribute("loading")).toBe("lazy");
        expect(img.getAttribute("width")).toBe("1280");
        expect(img.getAttribute("height")).toBe("853");
        expect(img.className).not.toContain("object-cover");
        expect(img.getAttribute("alt")).toContain("Romain Pontida");
    });

    it("読み込めなかった1枚は出典ごと隠し、全部読めなければ節ごと隠す", () => {
        view(SAMPLES);
        const imgs = () => screen.getByTestId("spot-samples").querySelectorAll("img");
        fireEvent.error(imgs()[0]);
        expect(imgs()).toHaveLength(1);
        expect(screen.getByTestId("spot-samples").textContent).not.toContain("Romain Pontida");
        fireEvent.error(imgs()[0]);
        expect(screen.queryByTestId("spot-samples")).toBeNull();
    });

    it("作例が無ければ節ごと出さない", () => {
        view([]);
        expect(screen.queryByTestId("spot-samples")).toBeNull();
        view(undefined);
        expect(screen.queryByTestId("spot-samples")).toBeNull();
    });
});
