import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot, SpotCoverImage } from "@/lib/data/spots";

/**
 * 代表写真の出典の行（2026-10-11 レビュー）:
 *  - 題を頭に出す（CC BY / BY-SA 1.0〜3.0 は題の表示が条件）
 *  - 枠に合わせて切り抜いて出していることを添える（CC 4.0 の「変更の表示」）
 */
const auth = vi.hoisted(() => ({ isAuthenticated: false, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn() }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const COVER: SpotCoverImage = {
    src: "/images/spots/x.jpg", alt: "高屋神社", title: "Takaya Shrine 01", aspectRatio: 1.5,
    credit: "撮った人", license: "cc-by-sa", licenseLabel: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Takaya_Shrine_01.jpg",
    checkedAt: "2026-10-11", verifiedPlace: true,
};
const SPOT: Spot = {
    spotId: "sp_takaya", slug: "takaya-jinja", name: "高屋神社", summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "香川県", city: "観音寺市" }, coords: { lat: 34.1, lng: 133.6 },
    highlights: ["雲海"], status: "published", verifiedBy: "運営", verifiedAt: "2026-09-25",
    createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z", coverImage: COVER,
};

const creditLine = (spot: Spot) => {
    const { container } = render(<ToastProvider><SpotGuideClient spot={spot} photos={[]} nearby={[]} locationPath={null} /></ToastProvider>);
    const a = container.querySelector(`a[href="${COVER.sourceUrl}"]`);
    return a?.closest("p")?.textContent ?? "";
};

describe("代表写真の出典の行", () => {
    it("題・作者・ライセンス・Commons・切り抜きの表示が1行に並ぶ", () => {
        expect(creditLine(SPOT)).toBe("Takaya Shrine 01 / 写真: 撮った人 / CC BY-SA 3.0 / Wikimedia Commons（一部を切り抜いて表示）");
    });

    it("題が無ければ頭は「写真:」から", () => {
        expect(creditLine({ ...SPOT, coverImage: { ...COVER, title: undefined } }))
            .toBe("写真: 撮った人 / CC BY-SA 3.0 / Wikimedia Commons（一部を切り抜いて表示）");
    });
});
