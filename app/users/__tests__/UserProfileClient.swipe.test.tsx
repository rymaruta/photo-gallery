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
    return screen.getByRole("tab", { name: new RegExp(name) });
}
function activeTab(): string {
    // **`role="tab"` ＋ `aria-selected`**（2026-09-22 に `aria-pressed` から
    // 直した。押し直しても外れない2つに「押されています」は嘘になるため）
    const btn = screen.getAllByRole("tab").find((b) => b.getAttribute("aria-selected") === "true");
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

    it("選んでいるタブだけが真鍮＋太字＋2px の下線（iOS v2・その人のテーマ色ではない）", () => {
        render(<UserProfileClient userId="nobody" />);
        const tabs = screen.getAllByRole("tab");
        const on = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
        expect(on).toHaveLength(1);
        expect(on[0].className.split(/\s+/)).toEqual(expect.arrayContaining(["text-accent", "font-semibold", "shadow-[inset_0_-2px_0_var(--color-accent)]"]));
        for (const off of tabs.filter((t) => t !== on[0])) expect(off.className.split(/\s+/)).not.toContain("text-accent");
    });

    it("アバターは黒 4px の縁だけ（回るオーロラの輪をやめた・iOS v2）", () => {
        const { container } = render(<UserProfileClient userId="nobody" />);
        const frame = container.querySelector("[data-avatar-frame]") as HTMLElement;
        expect(frame).not.toBeNull();
        expect(frame.className.split(/\s+/)).toEqual(expect.arrayContaining(["rounded-full", "border-4", "border-bg"]));
        expect(container.querySelector(".avatar-orbit")).toBeNull();
        const gradients = Array.from(container.querySelectorAll<HTMLElement>("[style]"))
            .filter((el) => /conic-gradient/.test(el.getAttribute("style") ?? ""));
        expect(gradients).toEqual([]);
    });

    it("廃止したタブ（足あと）は存在しない", () => {
        render(<UserProfileClient userId="nobody" />);
        expect(screen.queryByRole("tab", { name: /Footprints|足あと/ })).toBeNull();
    });

    // 2026-10-31 束 1 U9: 人のページの札は 投稿・マップ・年表（iOS の `ProfileTab.tabs(isMe: false)` ＋ Web だけの年表）
    it("人のページの札は 投稿・マップ・年表（旅は札にしない）", () => {
        render(<UserProfileClient userId="nobody" />);
        expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Posts", "Map", "Timeline"]);
    });

    it("左スワイプで 投稿 → マップ → 年表 に切り替わる", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left");
        expect(activeTab()).toContain("Map");
        swipe("left");
        expect(activeTab()).toContain("Timeline");
    });

    it("右端（年表）で左スワイプしてもクランプされ、年表のまま", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("left");
        swipe("left");
        swipe("left");
        expect(activeTab()).toContain("Timeline");
    });

    it("左端で右スワイプしてもクランプされ、投稿のまま", () => {
        render(<UserProfileClient userId="nobody" />);
        swipe("right");
        expect(activeTab()).toContain("Posts");
    });

    it("年表タブから右スワイプで マップ に戻る（前方向スワイプ）", () => {
        render(<UserProfileClient userId="nobody" />);
        fireEvent.click(tabButton("Timeline"));
        expect(activeTab()).toContain("Timeline");
        swipe("right");
        expect(activeTab()).toContain("Map");
    });

    it("地図の中で始まる横の操作では札を替えない（地図を動かしている）", () => {
        const { container } = render(<UserProfileClient userId="nobody" />);
        const area = screen.getByTestId("tab-swipe-area");
        const fake = document.createElement("div");
        fake.className = "leaflet-container";
        area.appendChild(fake);
        fireEvent.pointerDown(fake, { clientX: 240, clientY: 100 });
        fireEvent.pointerUp(fake, { clientX: 60, clientY: 108 });
        expect(activeTab()).toContain("Posts");
        expect(container).toBeTruthy();
    });

    it("縦方向の動きではタブが変わらない（縦スクロールを奪わない）", () => {
        render(<UserProfileClient userId="nobody" />);
        const area = screen.getByTestId("tab-swipe-area");
        fireEvent.pointerDown(area, { clientX: 100, clientY: 60 });
        fireEvent.pointerUp(area, { clientX: 108, clientY: 320 }); // 主に縦移動
        expect(activeTab()).toContain("Posts");
    });
});
