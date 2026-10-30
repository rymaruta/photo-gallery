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

import BottomNav, { activeTab, shownTab, TAB_CELL_ON } from "../BottomNav";

beforeEach(() => {
    nav.push.mockClear();
    nav.pathname = "/";
    auth.isAuthenticated = false;
    auth.userId = null;
    // 英語のテストが後始末を忘れても、次のテストへ漏らさない
    localeMock.locale = "ja";
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

    it("選んでいるタブだけが真鍮＋黒55%の丸い面＋太字（iOS v2・色だけに頼らない）", () => {
        nav.pathname = ROUTES.SEARCH;
        render(<BottomNav />);
        const cells = Array.from(
            screen.getByRole("navigation", { name: "メインメニュー" }).querySelectorAll("a,button"),
        ) as HTMLElement[];
        const on = cells.filter((el) => el.className.split(/\s+/).includes("text-accent"));
        expect(on.map((el) => el.textContent)).toEqual(["探す"]);
        expect(on[0].className.split(/\s+/)).toContain("bg-black/55");
        expect(on[0].getAttribute("aria-current")).toBe("page");
        // 太字（色の差だけでは見分けにくい）
        expect((on[0].querySelector("span") as HTMLElement).style.fontWeight).toBe("600");
        // 選んでいないタブは真鍮にも面にもならない
        for (const el of cells.filter((c) => c !== on[0])) {
            expect(el.className.split(/\s+/)).not.toContain("text-accent");
            expect(el.className.split(/\s+/)).not.toContain("bg-black/55");
        }
    });

    it("真鍮の字は、真っ白な写真が透けても 4.5:1 に届く（カプセルの地＋brightness 0.6＋黒55%）", async () => {
        const { TAB_CELL_ON } = await import("../BottomNav");
        const css = readFileSync(resolve(__dirname, "../../globals.css"), "utf8");
        const rule = css.slice(css.indexOf(".tabbar-capsule {"), css.indexOf("}", css.indexOf(".tabbar-capsule {")));
        const bg = /background:\s*rgb\((\d+) (\d+) (\d+) \/ (0?\.\d+)\)/.exec(rule);
        const bright = /[^-]backdrop-filter:[^;]*brightness\((0?\.\d+)\)/.exec(rule);
        const pill = /bg-black\/(\d+)/.exec(TAB_CELL_ON);
        const brass = /--color-accent:\s*#([0-9a-f]{6})/i.exec(css);
        expect(bg && bright && pill && brass).toBeTruthy();
        const a = Number(bg![4]), b = Number(bright![1]), p = Number(pill![1]) / 100;
        // 真っ白な写真（255）を暗くして、カプセルの地を重ね、黒の面を重ねる
        const under = (255 * b) * (1 - a);
        const base = [1, 2, 3].map((i) => (Number(bg![i]) * a + under) * (1 - p));
        const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
        const hex = brass![1];
        const fg = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const ratio = (lum(fg) + 0.05) / (lum(base) + 0.05);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
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

    // 本番で他人のページを開くと「マイページ」が光っていた（2026-10-15）
    it("人のページは、自分のときだけ「マイページ」", () => {
        expect(activeTab("/users/me-1", { myId: "me-1" })).toBe("me");
        expect(activeTab("/users/me-1/", { myId: "me-1" })).toBe("me");
        expect(activeTab("/users/other", { myId: "me-1" })).toBeNull();
        expect(activeTab("/users/me-1")).toBeNull();          // ログインしていない
        expect(activeTab("/users/a%20b", { myId: "a b" })).toBe("me");
        expect(activeTab("/users/%E0%A4%A", { myId: "x" })).toBeNull(); // 壊れた綴りで落ちない
    });

    it("クエリ版（/users?id=）も見ている人で決める", () => {
        expect(activeTab("/users", { myId: "me-1", profileId: "me-1" })).toBe("me");
        expect(activeTab("/users", { myId: "me-1", profileId: "other" })).toBeNull();
        expect(activeTab("/users", { myId: "me-1", profileId: null })).toBeNull();
    });

    // 人をさがすは iOS と同じく「探す」の中
    it("/users/search は「探す」", () => {
        expect(activeTab(ROUTES.USER_SEARCH, { myId: "search" })).toBe("search");
    });
});

/**
 * タブの無いページでは来た元のタブのまま（2026-10-30・束 0a・比較の板 C3）。
 * ただし他人のページで「マイページ」は光らせない（2026-10-15 に本番で光っていた件）
 */
describe("来た元のタブ（shownTab）", () => {
    const me = { myId: "me-1" };

    it("ホームから人のページ・写真へ来たら、ホームのまま", () => {
        expect(shownTab("/users/other", me, "home")).toBe("home");
        expect(shownTab("/photo/abc", me, "search")).toBe("search");
    });

    it("マイページから他人のページへ来ても「マイページ」は光らせない（クエリ版も）", () => {
        expect(shownTab("/users/other", me, "me")).toBeNull();
        expect(shownTab("/users", { myId: "me-1", profileId: "other" }, "me")).toBeNull();
        expect(shownTab("/users/other", {}, "me")).toBeNull();
    });

    it("自分のページは「マイページ」・写真なら来た元の「マイページ」のまま", () => {
        expect(shownTab("/users/me-1", me, "home")).toBe("me");
        expect(shownTab("/photo/abc", me, "me")).toBe("me");
    });

    it("読み込んだ直後（来た元が無い）は何も光らない", () => {
        expect(shownTab("/users/other", me, null)).toBeNull();
    });

    function lit(): string[] {
        return screen.getAllByRole("link").filter((a) => a.className.includes(TAB_CELL_ON)).map((a) => a.textContent ?? "");
    }
    function here(): string[] {
        return screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent ?? "");
    }

    it("描いた下の札: ホーム → 他人のページでホームが光ったまま（aria-current は付けない）", () => {
        auth.isAuthenticated = true;
        auth.userId = "me-1";
        nav.pathname = ROUTES.HOME;
        const { rerender } = render(<BottomNav />);
        expect(lit()).toEqual(["ホーム"]);
        nav.pathname = "/users/other";
        rerender(<BottomNav />);
        expect(lit()).toEqual(["ホーム"]);
        expect(here()).toEqual([]);
    });

    it("描いた下の札: マイページ → 他人のページで「マイページ」が消える", () => {
        auth.isAuthenticated = true;
        auth.userId = "me-1";
        nav.pathname = "/users/me-1";
        const { rerender } = render(<BottomNav />);
        expect(lit()).toEqual(["マイページ"]);
        nav.pathname = "/users/other";
        rerender(<BottomNav />);
        expect(lit()).toEqual([]);
    });
});
