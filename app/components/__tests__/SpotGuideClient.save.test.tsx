import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";

/**
 * **公式撮影地ガイドの「行きたい」は本物**（ダミーボタンではない）。
 *
 * owner:「保存機能が正しく実装されていない段階ではダミーボタンを表示しない」。
 * ここで固定するのは2つ:
 *
 *  1. ボタンが**在る**（置き忘れない）
 *  2. 送る鍵に**頭が付く**（`SPOT-<slug>`）——同じ綴りの撮影地と混ぜない
 */
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({ userFetch: fetchMock }));

// グリッドはこの判定の対象ではない（写真0枚でもページが成立するのが肝）
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
    officialWebsiteUrl: "https://example.example/",
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

beforeEach(() => {
    fetchMock.mockReset();
    auth.isAuthenticated = true;
    auth.loading = false;
});

describe("公式撮影地ガイドの「行きたい」", () => {
    it("ボタンが在る", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) });
        view();
        expect(await screen.findByRole("button", { name: "行きたい" })).toBeTruthy();
    });

    /// 🔴 **鍵に頭が付く。** 付けないと、同じ綴りの撮影地と同じ1件になる
    it("押すと `SPOT-<slug>` で保存する", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ slugs: [] }) });
        view();
        const btn = await screen.findByRole("button", { name: "行きたい" });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ slugs: ["SPOT-takaya-jinja"] }) });
        btn.click();
        await screen.findByRole("button", { name: "保存済み" });
        expect(fetchMock).toHaveBeenLastCalledWith(
            "/user/spots",
            expect.objectContaining({ body: JSON.stringify({ slug: "SPOT-takaya-jinja" }) }),
        );
    });

    /// **投稿が0枚でもページが成立する**（この画面の完成条件）
    it("写真が0枚でも、見出しと操作が出る", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) });
        view();
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("高屋神社");
        expect(screen.getByRole("link", { name: "地図で見る" })).toBeTruthy();
    });
});
