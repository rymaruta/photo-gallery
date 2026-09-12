import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * **`aria-controls` は、指す先が在るときだけ書く。**
 *
 * メニュー本体（`id="site-menu"`）は開いたときだけ描かれる（body へ
 * ポータルする）。無条件に `aria-controls="site-menu"` と書いていたので、
 * **閉じている全ページ＝実ビルドの141ページ全部**が存在しない id を
 * 指していた（2026-09-12 に `out/` を走査して判明）。
 *
 * ARIA は IDREF の指す先が在ることを求める。**状態は `aria-expanded` が
 * 伝える**ので、閉じている間に落としても読み上げは痩せない。
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false, userId: null }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../NotificationsBell", () => ({ default: () => null }));
vi.mock("../UserAvatar", () => ({ default: () => null }));

const HeaderNav = (await import("../HeaderNav")).default;

describe("メニューボタンの aria-controls", () => {
    it("閉じている間は、存在しない id を指さない", () => {
        render(<HeaderNav />);
        const btn = screen.getByRole("button", { name: "メニューを開く" });
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        expect(btn.getAttribute("aria-controls"), "閉じているのに id を指している").toBeNull();
        expect(document.getElementById("site-menu"), "閉じているのに本体が在る").toBeNull();
    });

    it("開いたら指す。そしてその id は実在する", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
        const btn = screen.getByRole("button", { name: "メニューを閉じる" });
        expect(btn.getAttribute("aria-expanded")).toBe("true");
        const ref = btn.getAttribute("aria-controls");
        expect(ref, "開いているのに指していない").toBe("site-menu");
        expect(document.getElementById(ref!), "指す先が存在しない").not.toBeNull();
    });
});
