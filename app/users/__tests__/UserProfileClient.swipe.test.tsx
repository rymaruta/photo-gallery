import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// --- 重い依存をモックしてプロフィール本体だけを描画する ---
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "en" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn().mockResolvedValue(null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
// 実物から足りない export を引き継ぐ（loadError 側と同じ理由）。
// userPublicFetch すらモックしていなかったが、この画面の経路では
// 一度も読まれないので通っていただけ。
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: vi.fn().mockResolvedValue({ ok: false }),
        userFetch: vi.fn().mockResolvedValue({ ok: false }),
        userPublicFetch: vi.fn().mockResolvedValue({ ok: false }),
    };
});

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

    it("廃止したタブ（足あと・旅）は存在しない", () => {
        render(<UserProfileClient userId="nobody" />);
        expect(screen.queryByRole("button", { name: /Map/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Trips/ })).toBeNull();
    });

    it("左スワイプで 投稿 → 年表 に切り替わる", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left");
        expect(activeTab()).toContain("Timeline");
    });

    it("右端で左スワイプしてもクランプされ、年表のまま", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left");
        swipe("left");
        expect(activeTab()).toContain("Timeline");
    });

    it("左端で右スワイプしてもクランプされ、投稿のまま", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("right");
        expect(activeTab()).toContain("Posts");
    });

    it("年表タブから右スワイプで 投稿 に戻る（前方向スワイプ）", () => {
        render(<UserProfileClient userId="nobody" />);
        fireEvent.click(tabButton("Timeline"));
        expect(activeTab()).toContain("Timeline");
        swipe("right");
        expect(activeTab()).toContain("Posts");
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
