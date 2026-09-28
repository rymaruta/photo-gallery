import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTES } from "@/lib/routes";

/**
 * 画面下の5つのタブ。
 *
 * **常駐するので、開いたシートを閉じる責任がこちらにある**（`PostSheet` の
 * docstring がそう書いている）。シートそのものの作法は
 * `PostSheet.test.tsx` が見る——ここは入口の出し分けと、いま居る場所の印。
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: nav.push }),
    usePathname: () => nav.pathname,
}));

const auth = vi.hoisted(() => ({ isAuthenticated: false, userId: null as string | null }));
vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: auth.isAuthenticated, userId: auth.userId }),
}));
const localeMock = vi.hoisted(() => ({ locale: "ja" as "ja" | "en" }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: localeMock.locale, labels: {} }) }));

import BottomNav, { activeTab } from "../BottomNav";

beforeEach(() => {
    nav.push.mockClear();
    nav.pathname = "/";
    auth.isAuthenticated = false;
    auth.userId = null;
    document.documentElement.style.removeProperty("--bottom-bar-h");
});

describe("画面下の5つのタブ", () => {
    it("英語の文言も iOS と同じ（Search・My Page）", () => {
        localeMock.locale = "en";
        try {
            render(<BottomNav />);
            const bar = screen.getByRole("navigation", { name: "Main" });
            const cells = Array.from(bar.querySelectorAll("a,button")).map((el) => el.textContent);
            expect(cells).toEqual(["Home", "Search", "Post", "Map", "My Page"]);
        } finally {
            localeMock.locale = "ja";
        }
    });

    it("ホーム・探す・投稿・マップ・マイページが、この並びで出る", () => {
        render(<BottomNav />);
        // 並びごと見る（`toContain` の羅列だと入れ替えが素通りする）
        const bar = screen.getByRole("navigation", { name: "メインメニュー" });
        const cells = Array.from(bar.querySelectorAll("a,button")).map((el) => el.textContent);
        expect(cells).toEqual(["ホーム", "探す", "投稿", "マップ", "マイページ"]);
    });

    it("いま居る場所のタブだけが aria-current を持つ", () => {
        nav.pathname = ROUTES.MAP;
        render(<BottomNav />);
        const marked = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
        expect(marked.map((a) => a.textContent)).toEqual(["マップ"]);
    });

    it("未ログインだと、投稿はログインへ送る（戻り先つき）", () => {
        render(<BottomNav />);
        fireEvent.click(screen.getByRole("button", { name: "投稿" }));
        expect(nav.push).toHaveBeenCalledWith(`${ROUTES.LOGIN}?next=${encodeURIComponent(ROUTES.UPLOAD)}`);
        // シートは開かない
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("ログイン中は、投稿で2択のシートが開く", () => {
        auth.isAuthenticated = true;
        auth.userId = "u1";
        render(<BottomNav />);
        fireEvent.click(screen.getByRole("button", { name: "投稿" }));
        expect(nav.push).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("画面が変わったら、開いていたシートを閉じる（常駐するので遷移では外れない）", () => {
        auth.isAuthenticated = true;
        auth.userId = "u1";
        const { rerender } = render(<BottomNav />);
        fireEvent.click(screen.getByRole("button", { name: "投稿" }));
        expect(screen.getByRole("dialog")).toBeTruthy();

        nav.pathname = ROUTES.MAP;
        rerender(<BottomNav />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("離れてから戻ってきても、触っていないのに開き直さない", () => {
        // **`開いている = (開いたパス === 今のパス)` と書くとここで落ちる。**
        // `HeaderNav` が同じ場面で一度回帰にした形で、こちらも最初それを
        // 書いていた（変異テストで見つけた）
        auth.isAuthenticated = true;
        auth.userId = "u1";
        const { rerender } = render(<BottomNav />);
        fireEvent.click(screen.getByRole("button", { name: "投稿" }));
        expect(screen.getByRole("dialog")).toBeTruthy();

        nav.pathname = ROUTES.MAP;
        rerender(<BottomNav />);
        nav.pathname = ROUTES.HOME;          // 戻る
        rerender(<BottomNav />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("クエリだけ変わる移動（戻る・進む）でも閉じる", () => {
        // `/users?id=A` → `?id=B` はパスが変わらないので、上のパス比較では拾えない。
        // **これを持っているのは `PostSheet` の方**（あちらが開いている間だけ
        // `popstate` を聞く）。ここには置かない——二重にすると片方を壊しても
        // 観測できない。この1本は「繋がっていること」を見る
        auth.isAuthenticated = true;
        auth.userId = "u1";
        nav.pathname = "/users";
        render(<BottomNav />);
        fireEvent.click(screen.getByRole("button", { name: "投稿" }));
        expect(screen.getByRole("dialog")).toBeTruthy();

        fireEvent.popState(window);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("マイページの行き先は、ログインしていなければログイン", () => {
        render(<BottomNav />);
        expect(screen.getByRole("link", { name: "マイページ" }).getAttribute("href")).toBe(ROUTES.LOGIN);
    });

    it("マイページの行き先は、ログイン中なら自分のプロフィール", () => {
        auth.isAuthenticated = true;
        auth.userId = "u1";
        render(<BottomNav />);
        expect(screen.getByRole("link", { name: "マイページ" }).getAttribute("href"))
            .toBe(ROUTES.USER_PROFILE("u1"));
    });

    it("公開ページに常駐するので、どのリンクも先読みしない", () => {
        render(<BottomNav />);
        // Next の <Link> は prefetch={false} を DOM の属性には出さないので、
        // 走査側（`app/__tests__/linkPrefetch.test.ts`）がソースで見る。
        // ここでは「リンクが4本ある」ことだけ固定して、走査の対象から
        // 外れていないことを保つ
        expect(screen.getAllByRole("link")).toHaveLength(4);
    });

    it("高さを --bottom-bar-h に出す（ミニプレイヤーがこれを読んで上に逃げる）", () => {
        render(<BottomNav />);
        // jsdom は offsetHeight が 0 だが、**変数が設定されること**が肝
        // （設定されないと body の見積もりのままで、実寸とずれる）
        expect(document.documentElement.style.getPropertyValue("--bottom-bar-h")).toBe("0px");
    });
});

describe("浮いたカプセル（iOS の案B・owner の決定 2026-09-27）", () => {
    it("帯の外側の隙間は押せず、押せるのはカプセルの中だけ", () => {
        // `nav` は下端いっぱいに敷く透明な帯。隙間まで押せる形にすると、
        // そこに透けて見えている写真やリンクが押せなくなる
        render(<BottomNav />);
        const bar = screen.getByRole("navigation", { name: "メインメニュー" });
        expect(bar.className.split(/\s+/)).toContain("pointer-events-none");
        const capsule = bar.firstElementChild as HTMLElement;
        expect(capsule.className.split(/\s+/)).toContain("pointer-events-auto");
        // 5つのマスはすべてカプセルの中にある
        expect(capsule.querySelectorAll("a,button")).toHaveLength(5);
    });

    it("選んでいるタブだけが白16%の丸い面を持つ", () => {
        nav.pathname = ROUTES.SEARCH;
        render(<BottomNav />);
        const withSurface = Array.from(
            screen.getByRole("navigation", { name: "メインメニュー" }).querySelectorAll("a,button"),
        ).filter((el) => el.className.split(/\s+/).includes("bg-white/16"));
        expect(withSurface.map((el) => el.textContent)).toEqual(["探す"]);
    });

    it("写真が透けても字が読める: 非選択は白72%・透けた写真は brightness 0.6 で暗くする", () => {
        // モックの値（白60%・ぼかしだけ）だと真っ白な写真の上で 2.62:1
        // （レビューが計算）。72% ＋ 0.6 で最悪でも 4.93:1
        nav.pathname = ROUTES.MAP;
        render(<BottomNav />);
        const cells = Array.from(
            screen.getByRole("navigation", { name: "メインメニュー" }).querySelectorAll("a,button"),
        ).filter((el) => el.getAttribute("aria-current") !== "page");
        expect(cells).toHaveLength(4);
        for (const el of cells) expect(el.className.split(/\s+/)).toContain("text-white/72");
        const css = readFileSync(resolve(__dirname, "../../globals.css"), "utf8");
        const rule = css.slice(css.indexOf(".tabbar-capsule {"), css.indexOf("}", css.indexOf(".tabbar-capsule {")));
        expect(rule).toMatch(/[^-]backdrop-filter:[^;]*brightness\(0\.6\)/);
        expect(rule).toMatch(/-webkit-backdrop-filter:[^;]*brightness\(0\.6\)/);
    });

    it("下の隙間は 22px と safe-area の大きい方（ホームインジケーターに被らない）", () => {
        // **ソースで見る。** jsdom の CSS の解釈は `max()` と `env()` を落とすので、
        // 描いた DOM の style からは読めない（実ブラウザでは効く）
        const src = readFileSync(resolve(__dirname, "../BottomNav.tsx"), "utf8");
        expect(src).toContain('paddingBottom: "max(22px, env(safe-area-inset-bottom, 0px))"');
    });
});

describe("どのタブを光らせるか（activeTab）", () => {
    it.each([
        [ROUTES.HOME, "home"],
        [ROUTES.SEARCH, "search"],
        [ROUTES.MAP, "map"],
        ["/users/abc", "me"],
        ["/users", "me"],           // クエリ版（/users?id=）
        ["/user/profile", "me"],
        ["/user/drafts", "me"],
    ])("%s → %s", (path, key) => {
        expect(activeTab(path)).toBe(key);
    });

    it.each([
        ["/photo/abc"],
        ["/tag/finland"],
        ["/login"],
        ["/privacy"],
    ])("%s はどのタブでもない", (path) => {
        expect(activeTab(path)).toBeNull();
    });

    it("/users で始まるだけの別ページを巻き込まない", () => {
        // `/users/search`（人をさがす）は「マイページ」ではない…が、
        // いまは前置きで拾う。**そうと分かって拾っている**ことを固定する
        // （分けるなら `ROUTES.USER_SEARCH` を先に見る1行を足す）
        expect(activeTab(ROUTES.USER_SEARCH)).toBe("me");
    });
});
