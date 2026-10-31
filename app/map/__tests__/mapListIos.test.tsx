import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { SpotPin } from "../../../lib/data/spotLink";

vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import MapSpotList from "../MapSpotList";
import MapSpotSheet from "../MapSpotSheet";
import MapPhotoList from "../MapPhotoList";

/**
 * **地図の一覧の行と撮影スポットの札を iOS にそろえた形**（2026-10-31 束 2 M1・M2・M5・iOS の `PhotoMapView`）。
 * どれも直しを戻すと落ちる
 */
const PIN: SpotPin = { slug: "takaya-jinja", name: "高屋神社", region: "香川県 観音寺市", lat: 34.1, lng: 133.6, cover: null, stage: "published" };
const WITH_COVER = { ...PIN, cover: { src: "/images/spots/thumb/t.jpg", alt: "高屋神社", credit: "写真: Someone / CC BY-SA 4.0" } } as SpotPin;

describe("地図の一覧（撮影スポットの行）", () => {
    it("見出しは「撮影スポット」（「公式」を付けない）", () => {
        render(<MapSpotList spots={[PIN]} locale="ja" />);
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("撮影スポット");
    });

    it("行は黒地に直に・高さ 64・下に白8%の線、名前は明朝 18", () => {
        render(<MapSpotList spots={[PIN, WITH_COVER]} locale="ja" />);
        const rows = screen.getAllByTestId("map-spot-row");
        for (const r of rows) {
            expect(r.className).toContain("min-h-[64px]");
            expect(r.className).toContain("border-b");
            expect(r.className).not.toContain("rounded-2xl");
        }
        const name = within(rows[0]).getByText("高屋神社");
        expect(name.className).toContain("font-serif");
        expect(name.style.fontSize).toBe("18px");
        // 写真の無い行は真鍮の丸にカメラ、写真のある行は写真の丸
        expect(rows[0].querySelector("span.bg-accent svg")).toBeTruthy();
        expect(rows[1].querySelector("span.rounded-full img")).toBeTruthy();
    });
});

describe("地図の一覧（写真の行）", () => {
    it("行は撮影スポットの行と同じ形（高さ 64・線で区切る）", () => {
        render(<MapPhotoList locale="ja" photos={[{ id: "a", src: "https://x/uploads/a.jpg", location: "パリ", coords: { lat: 1, lng: 2 } } as never]} />);
        const row = screen.getByTestId("map-photo-row");
        expect(row.className).toContain("min-h-[64px]");
        expect(row.className).toContain("border-b");
    });
});

describe("地図の撮影スポットの札", () => {
    const sheet = (spot: SpotPin) => render(<ToastProvider><MapSpotSheet spot={spot} locale="ja" onClose={() => {}} /></ToastProvider>);

    it("名前は明朝 22、眉は白（札はガラスの地）", () => {
        sheet(PIN);
        const name = screen.getByText("高屋神社");
        expect(name.style.fontSize).toBe("22px");
        const eyebrow = screen.getByText("撮影スポット");
        expect(eyebrow.className).toContain("eyebrow");
        expect(eyebrow.className).not.toContain("text-accent");
    });

    it("写真は札の頭に大きく（高さ 150）、出典は 12 で写真の下に（8px の重ねをやめた）", () => {
        sheet(WITH_COVER);
        const credit = screen.getByTestId("map-spot-credit");
        expect(credit.style.fontSize).toBe("12px");
        const img = screen.getByAltText("高屋神社");
        expect((img.parentElement as HTMLElement).style.height).toBe("150px");
    });

    it("閉じるは 44、主ボタンは白の塗りで高さ 44", () => {
        sheet(PIN);
        const close = screen.getByRole("button", { name: "閉じる" });
        expect(close.style.width).toBe("44px");
        const open = screen.getByTestId("map-spot-guide-link");
        expect(open.className).toContain("bg-primary");
        expect(open.style.minHeight).toBe("44px");
    });
});
