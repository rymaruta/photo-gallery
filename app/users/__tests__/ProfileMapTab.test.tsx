import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

// 地図（Leaflet）は描かない。渡されたピンと、押したときの選択だけ見る
vi.mock("next/dynamic", () => ({
    default: () => function FakeMap({ photos, onSelect }: { photos: { id: string }[]; onSelect: (s: unknown) => void }) {
        return (
            <div data-testid="fake-map" data-count={photos.length}>
                <button type="button" onClick={() => onSelect({ photos, index: 0 })}>ピン</button>
            </div>
        );
    },
}));
vi.mock("../../map/MapPhotoSheet", () => ({
    default: ({ photos, index }: { photos: { id: string }[]; index: number }) => <div data-testid="fake-sheet">{photos[index].id}</div>,
}));

const ProfileMapTab = (await import("../ProfileMapTab")).default;

const P = (id: string, coords?: { lat: number; lng: number }) => ({ id, src: `https://cdn.example.com/${id}.jpg`, coords } as unknown as Photo);

/** 2026-10-31 束 1 U6・U9: 人のページの「マップ」の札（iOS の `MyPhotosMap`）。訪れた場所のチップの代わり */
describe("人のページのマップの札", () => {
    it("座標のある写真だけをピンにし、押すと下のシートで開く", () => {
        render(<ProfileMapTab locale="ja" photos={[P("a", { lat: 35, lng: 139 }), P("b"), P("c", { lat: 48.8, lng: 2.3 })]} />);
        expect(screen.getByTestId("fake-map").getAttribute("data-count")).toBe("2");
        expect(screen.queryByTestId("fake-sheet")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "ピン" }));
        expect(screen.getByTestId("fake-sheet").textContent).toBe("a");
    });

    it("座標のある写真が無ければ地図の枠を出さず、空の案内", () => {
        render(<ProfileMapTab locale="ja" photos={[P("b")]} />);
        expect(screen.queryByTestId("fake-map")).toBeNull();
        expect(screen.getByTestId("profile-map-empty").textContent).toContain("撮影地の分かる写真はまだありません");
    });
});
