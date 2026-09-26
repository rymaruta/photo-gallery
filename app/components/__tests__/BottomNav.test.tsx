import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import BottomNav, { activeTab } from "../BottomNav";

beforeEach(() => {
    nav.push.mockClear();
    nav.pathname = "/";
    auth.isAuthenticated = false;
    auth.userId = null;
    document.documentElement.style.removeProperty("--bottom-bar-h");
});

describe("画面下の5つのタブ", () => {
    it("ホーム・さがす・投稿・マップ・マイページが、この並びで出る", () => {
        render(<BottomNav />);
        // 並びごと見る（`toContain` の羅列だと入れ替えが素通りする）
        const bar = screen.getByRole("navigation", { name: "メインメニュー" });
        const cells = Array.from(bar.querySelectorAll("a,button")).map((el) => el.textContent);
        expect(cells).toEqual(["ホーム", "さがす", "投稿", "マップ", "マイページ"]);
    });

    it("いま居る場所のタブだけが aria-current を持つ", () => {
        nav.pathname = ROUTES.MAP;
        render(<BottomNav />);
        const marked = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
        expect(marked.map((a) => a.textContent)).toEqual(["マップ"]);
    });

    it("選択中は白の面＋太字（真鍮にしない・色だけで状態を言わない）", () => {
        // 板「01 ホーム」の下部タブ。デザインシステム「下部ナビのアイコン＝白」
        nav.pathname = ROUTES.MAP;
        render(<BottomNav />);
        const on = screen.getAllByRole("link").find((a) => a.getAttribute("aria-current") === "page")!;
        const off = screen.getByRole("link", { name: "ホーム" });
        expect(on.className).toContain("bg-white/[0.16]");
        expect(on.className).toContain("font-semibold");
        expect(on.className).not.toContain("text-accent");
        expect(off.className).not.toContain("bg-white/[0.16]");
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

describe("どのタブを光らせるか（activeTab）", () => {
    it.each([
        [ROUTES.HOME, "home"],
        [ROUTES.SEARCH, "search"],
        [ROUTES.MAP, "map"],
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

    it("自分のプロフィールは「マイページ」（静的・クエリ版の両方）", () => {
        expect(activeTab("/users/me-1", "", "me-1")).toBe("me");
        expect(activeTab("/users", "?id=me-1", "me-1")).toBe("me");
        // 書き出しの末尾スラッシュ・符号化された id でも同じ
        expect(activeTab("/users/me-1/", "", "me-1")).toBe("me");
        expect(activeTab("/users/a%20b", "", "a b")).toBe("me");
    });

    it("他の人のプロフィールでは「マイページ」を光らせない", () => {
        // 以前は `/users/` の前置きだけで見ていて、誰のページでも光った
        expect(activeTab("/users/someone", "", "me-1")).toBeNull();
        expect(activeTab("/users", "?id=someone", "me-1")).toBeNull();
    });

    it("誰か分からない（未ログイン）ときは、プロフィールでも光らせない", () => {
        expect(activeTab("/users/someone")).toBeNull();
        expect(activeTab("/users", "?id=someone", null)).toBeNull();
        expect(activeTab("/users", "", null)).toBeNull();
    });

    it("/users/search（人をさがす）はマイページではない", () => {
        expect(activeTab(ROUTES.USER_SEARCH, "", "me-1")).toBeNull();
    });

    it("描画: 他の人のプロフィールを開くと、どのタブも aria-current を持たない", () => {
        auth.isAuthenticated = true;
        auth.userId = "me-1";
        nav.pathname = "/users/someone";
        render(<BottomNav />);
        const marked = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
        expect(marked).toEqual([]);
    });

    it("描画: パスが同じまま id だけ変わっても追いかける（/users?id=me-1 → ?id=someone）", async () => {
        // `usePathname` は変わらないので、描き直しは URL の購読だけが頼り
        auth.isAuthenticated = true;
        auth.userId = "me-1";
        nav.pathname = "/users";
        window.history.replaceState(null, "", "/users?id=me-1");
        try {
            render(<BottomNav />);
            const lit = () => screen.getAllByRole("link")
                .filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);
            expect(lit()).toEqual(["マイページ"]);
            await act(async () => { window.history.pushState(null, "", "/users?id=someone"); });
            expect(lit()).toEqual([]);
            await act(async () => { window.history.pushState(null, "", "/users?id=me-1"); });
            expect(lit()).toEqual(["マイページ"]);
        } finally {
            window.history.replaceState(null, "", "/");
        }
    });

    it("useInsertionEffect の中の pushState でも、開発版 React の警告を出さない", async () => {
        // Next の `HistoryUpdater` は遷移の URL を `useInsertionEffect` の中で書く。
        // 包みがその場で知らせると、React が「insertion effect で更新を予約した」と
        // console.error を出す（BottomNav は全ページに居るので全ページで出る）
        nav.pathname = "/users";
        window.history.replaceState(null, "", "/users?id=a");
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        function Navigator({ to }: { to: string }) {
            React.useInsertionEffect(() => { window.history.pushState(null, "", to); }, [to]);
            return null;
        }
        try {
            const { rerender } = render(<><BottomNav /><Navigator to="/users?id=a" /></>);
            await act(async () => { rerender(<><BottomNav /><Navigator to="/users?id=b" /></>); });
            const msgs = errors.mock.calls.map((c) => String(c[0]));
            expect(msgs.filter((m) => m.includes("useInsertionEffect must not schedule updates"))).toEqual([]);
        } finally {
            errors.mockRestore();
            window.history.replaceState(null, "", "/");
        }
    });

    it("描画: クエリ版の自分のページでは「マイページ」が光る", () => {
        auth.isAuthenticated = true;
        auth.userId = "me-1";
        nav.pathname = "/users";
        window.history.replaceState(null, "", "/users?id=me-1");
        try {
            render(<BottomNav />);
            const marked = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
            expect(marked.map((a) => a.textContent)).toEqual(["マイページ"]);
        } finally {
            window.history.replaceState(null, "", "/");
        }
    });
});
