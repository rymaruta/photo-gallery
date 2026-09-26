import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
// 表示まで見るので、画面に出す部品つきの方（layout と同じ）を使う
import ToastProvider from "../ToastProvider";
import type { Spot } from "@/lib/data/spots";

/**
 * 公式撮影地ガイドの「シェア」（デザイン「13 スポット」の3つ目のボタン）。
 * 共有の中身は写真ページと同じ `shareUrl`（`lib/utils/share.ts` の試験が見る）。
 * ここは「このスポットの URL を渡すか」と「結果を利用者に知らせるか」。
 */
const auth = vi.hoisted(() => ({ isAuthenticated: false, loading: false, userId: null }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({ userFetch: fetchMock }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_takaya",
    slug: "takaya-jinja",
    name: "高屋神社",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
    coords: { lat: 34.1, lng: 133.6 },
    highlights: ["雲海が出る朝がある"],
    status: "published",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};

const view = () => render(
    <ToastProvider>
        <SpotGuideClient spot={SPOT} photos={[]} nearby={[]} locationPath={null} />
    </ToastProvider>,
);

const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) });
});
afterEach(() => {
    if (originalShare) Object.defineProperty(navigator, "share", originalShare);
    else delete (navigator as { share?: unknown }).share;
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    // 途中の assert で落ちても差し替えたまま残さない
    delete (document as { execCommand?: unknown }).execCommand;
});

describe("公式撮影地ガイドの「シェア」", () => {
    it("このスポットの URL と名前を共有シートに渡す", async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "share", { value: share, configurable: true });
        view();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        expect(share.mock.calls[0][0]).toMatchObject({
            title: "高屋神社",
            url: `${window.location.origin}/spots/takaya-jinja`,
        });
    });

    it("共有シートが無ければリンクをコピーし、そう知らせる", async () => {
        delete (navigator as { share?: unknown }).share;
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        view();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/spots/takaya-jinja`));
        expect(await screen.findByText("リンクをクリップボードにコピーしました")).toBeTruthy();
    });

    it("共有もコピーもできなければ、黙らずに失敗を知らせる", async () => {
        delete (navigator as { share?: unknown }).share;
        const writeText = vi.fn().mockRejectedValue(new Error("denied"));
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        // 古い方法（execCommand）も断られる環境
        const exec = vi.fn().mockReturnValue(false);
        Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
        view();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        expect(await screen.findByText("共有できませんでした")).toBeTruthy();
        expect(exec).toHaveBeenCalledWith("copy");
    });
});
