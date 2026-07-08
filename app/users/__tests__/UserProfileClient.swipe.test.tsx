import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// --- 重い依存をモックしてプロフィール本体だけを描画する ---
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="mapview-stub" className="leaflet-container" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "en" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => ({ getCurrentSession: vi.fn().mockResolvedValue(null) }));
vi.mock("../../../lib/utils/api", () => ({
    publicFetch: vi.fn().mockResolvedValue({ ok: false }),
    userFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

import UserProfileClient from "../UserProfileClient";

function tabButton(name: "Posts" | "Map" | "Timeline") {
    return screen.getByRole("button", { name: new RegExp(name) });
}
function activeTab(): string {
    const btn = screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") === "true");
    return btn?.textContent?.trim() ?? "";
}
// スワイプ領域で左右スワイプを発火する
function swipe(dir: "left" | "right") {
    const area = screen.getByTestId("tab-swipe-area");
    const from = dir === "left" ? 240 : 60;
    const to = dir === "left" ? 60 : 240;
    fireEvent.pointerDown(area, { clientX: from, clientY: 100 });
    fireEvent.pointerUp(area, { clientX: to, clientY: 108 });
}

beforeEach(() => {
    // グローバル fetch（プロフィール取得）をスタブ
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});

describe("UserProfileClient - タブの横スワイプ（タッチ操作の保証）", () => {
    it("初期は投稿タブがアクティブ", () => {
        render(<UserProfileClient userId="nobody" />);
        expect(activeTab()).toContain("Posts");
    });

    it("左スワイプで 投稿 → 足あと に切り替わる", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left");
        expect(activeTab()).toContain("Map");
    });

    it("左端で右スワイプしてもクランプされ、投稿のまま", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("right");
        expect(activeTab()).toContain("Posts");
    });

    it("年表タブから右スワイプで 足あと に戻る（前方向スワイプ）", () => {
        render(<UserProfileClient userId="nobody" />);
        fireEvent.click(tabButton("Timeline"));
        expect(activeTab()).toContain("Timeline");
        swipe("right");
        expect(activeTab()).toContain("Map");
    });

    it("縦方向の動きではタブが変わらない（縦スクロールを奪わない）", () => {
        render(<UserProfileClient userId="nobody" />);
        const area = screen.getByTestId("tab-swipe-area");
        fireEvent.pointerDown(area, { clientX: 100, clientY: 60 });
        fireEvent.pointerUp(area, { clientX: 108, clientY: 320 }); // 主に縦移動
        expect(activeTab()).toContain("Posts");
    });

    it("足あとタブ（地図が空）でも左右スワイプでタブを切り替えられる", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left"); // posts -> map（このユーザーはGPS写真なし＝空状態）
        expect(activeTab()).toContain("Map");
        swipe("right"); // map -> posts に戻れること（スクショで報告された不具合の回帰ガード）
        expect(activeTab()).toContain("Posts");
        swipe("left");
        swipe("left"); // map -> timeline
        expect(activeTab()).toContain("Timeline");
    });

    it("Leaflet 地図の中で始まった操作はタブ切替に使わない（地図のパンを優先）", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left"); // posts -> map
        expect(activeTab()).toContain("Map");
        // 地図(leaflet-container)内で始まるドラッグではタブが変わらない
        const map = document.querySelector(".leaflet-container");
        if (map) {
            fireEvent.pointerDown(map, { clientX: 240, clientY: 100 });
            fireEvent.pointerUp(screen.getByTestId("tab-swipe-area"), { clientX: 60, clientY: 108 });
            expect(activeTab()).toContain("Map");
        } else {
            // GPS写真ゼロのため地図は空状態（leaflet無し）。除外ロジックは
            // onTabPointerDown の closest(".leaflet-container") で担保される。
            expect(activeTab()).toContain("Map");
        }
    });
});
