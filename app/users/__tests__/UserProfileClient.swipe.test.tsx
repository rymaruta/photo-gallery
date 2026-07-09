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

function tabButton(name: "Posts" | "Trips" | "Map" | "Timeline") {
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

    it("足あとタブは非表示（SHOW_MAP_TAB=false の間）", () => {
        render(<UserProfileClient userId="nobody" />);
        expect(screen.queryByRole("button", { name: /Map/ })).toBeNull();
    });

    it("左スワイプで 投稿 → 旅 → 年表 と順に切り替わる", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left");
        expect(activeTab()).toContain("Trips");
        swipe("left");
        expect(activeTab()).toContain("Timeline");
    });

    it("左端で右スワイプしてもクランプされ、投稿のまま", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("right");
        expect(activeTab()).toContain("Posts");
    });

    it("年表タブから右スワイプで 旅 に戻る（前方向スワイプ）", () => {
        render(<UserProfileClient userId="nobody" />);
        fireEvent.click(tabButton("Timeline"));
        expect(activeTab()).toContain("Timeline");
        swipe("right");
        expect(activeTab()).toContain("Trips");
    });

    it("右端（年表）で左スワイプしてもクランプされる", () => {
        render(<UserProfileClient userId="nobody" />);
        fireEvent.click(tabButton("Timeline"));
        swipe("left");
        expect(activeTab()).toContain("Timeline");
    });

    it("縦方向の動きではタブが変わらない（縦スクロールを奪わない）", () => {
        render(<UserProfileClient userId="nobody" />);
        const area = screen.getByTestId("tab-swipe-area");
        fireEvent.pointerDown(area, { clientX: 100, clientY: 60 });
        fireEvent.pointerUp(area, { clientX: 108, clientY: 320 }); // 主に縦移動
        expect(activeTab()).toContain("Posts");
    });
});
