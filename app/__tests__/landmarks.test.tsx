import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// **読み上げでページを辿れるか。** Chromium で主要9画面の見出しと
// ランドマークを実測して出た2件を固定する（測定は `scripts/audit-landmarks.mjs`）:
//
// 1. **ホームだけ h1 が0件だった**（390px 幅）。タイトルは `hidden sm:flex` の
//    中にあり、狭い画面では `display:none` ＝読み上げの木からも消える。
//    ホームはこのサイトの入口で、検索から来た人が最初に開く画面。
// 2. **無名の `<nav>` が全ページに2つ**（ヘッダーとフッター）。同じ種類の
//    ランドマークが複数あるとき、名前が無いと「ナビゲーション」が2回読まれる
//    だけで、どちらへ行けばよいか分からない。
//
// jsdom は CSS を評価しない（`sm:hidden` が効かない）ので、**どの幅で見えるか**
// はブラウザで測る。ここでは「置いてあるか・消えていないか」を描画して見る。

const authState = vi.hoisted(() => ({ current: { isAuthenticated: false, userId: null as string | null, loading: false } }));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { navigation: {}, category: { all: "すべて", names: {} }, site: { title: "作品紹介" } } }),
}));
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ loaded: true, photos: [] }) }));
vi.mock("../data/photos.json", () => ({ default: [] }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
}));
import ToastProvider from "../components/ToastProvider";

/** クラス名を「語」として見る。`includes("sr-only")` は `not-sr-only` にも当たる */
const hasClass = (el: Element | null, name: string) =>
    ` ${el?.className ?? ""} `.includes(` ${name} `);

describe("ランドマークに名前が付いている", () => {
    it.each([
        ["フッター", async () => (await import("../components/Footer")).default],
        ["ヘッダー", async () => (await import("../components/HeaderNav")).default],
    ])("%s のナビに名前がある（もう一方と区別できる）", async (_name, load) => {
        const Component = await load();
        const { container } = render(<ToastProvider><Component /></ToastProvider>);
        const navs = [...container.querySelectorAll("nav")];
        expect(navs.length, "ナビが1つも無い").toBeGreaterThan(0);
        for (const nav of navs) {
            expect(nav.getAttribute("aria-label") || nav.getAttribute("aria-labelledby"),
                `名前の無いランドマーク: ${nav.className}`).toBeTruthy();
        }
    });

    it("2つのナビの名前が違う（同じ名前だと区別にならない）", async () => {
        const Footer = (await import("../components/Footer")).default;
        const HeaderNav = (await import("../components/HeaderNav")).default;
        const f = render(<ToastProvider><Footer /></ToastProvider>).container.querySelector("nav")?.getAttribute("aria-label");
        const h = render(<ToastProvider><HeaderNav /></ToastProvider>).container.querySelector("nav")?.getAttribute("aria-label");
        expect(f).toBeTruthy();
        expect(h).toBeTruthy();
        expect(f).not.toBe(h);
    });
});

describe("ホームに見出しがある", () => {
    it("狭い画面用の見出しが実際に描かれ、広い画面では隠れる指定を持つ", async () => {
        const GalleryPageClient = (await import("../GalleryPageClient")).default;
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        // jsdom は CSS を見ないので両方 DOM に居る。**描かれていること**を見る
        const h1s = screen.getAllByRole("heading", { level: 1 });
        expect(h1s.length, "見出しが1つしか無い（どちらかの幅で0件になる）").toBe(2);

        const srOnly = h1s.find((h) => hasClass(h, "sr-only"));
        expect(srOnly, "画面に出さない見出しが無い（狭い画面で h1 が0件になる）").toBeTruthy();
        // **`not-sr-only` を「sr-only を含む」で通していた**——それはスマホで
        // 見出しが目に見えて増える変異なのに素通りしていた
        expect(hasClass(srOnly!, "not-sr-only"), "見えてしまう指定になっている").toBe(false);
        expect(hasClass(srOnly!, "sm:hidden"), "広い画面で見出しが2つになる").toBe(true);
        expect(srOnly!.textContent?.trim(), "名前の無い見出し（読み上げても何も分からない）").toBeTruthy();

        // 見える方は今までどおり広い画面だけ（クラスの並び順には縛られない）
        const visible = h1s.find((h) => h !== srOnly)!;
        // **見出し自身が隠されていないか**も見る（包みだけ見ていたら、
        // `<h1 className="hidden">` にする変異が素通りした）
        expect(hasClass(visible, "hidden"), "見える方の見出し自体が隠されている").toBe(false);
        expect(hasClass(visible, "sr-only"), "見える方の見出しが読み上げ専用になっている").toBe(false);
        const wrapper = visible.closest("div")!.parentElement!;
        expect(hasClass(wrapper, "hidden"), "狭い画面でも見える方が出ている").toBe(true);
        expect(wrapper.className, "広い画面で出る指定が無い").toMatch(/\bsm:flex\b/);
    });
});
