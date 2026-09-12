import { describe, it, expect, beforeEach } from "vitest";
import { isAssetElement, shouldAutoReload, markReloaded, stylesheetsApplied } from "../assetRecovery";

// 外部ブラウザ等で CSS/JS の読み込みに失敗し「壊れたページ」になったとき、
// 1回だけ自動リロードして復旧する仕組みの回帰ガード。

function makeStorage(): Storage {
    const store: Record<string, string> = {};
    return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        key: () => null,
        get length() { return Object.keys(store).length; },
    } as Storage;
}

// **文書自身のオリジンを基準にする。** 別の文字列を渡すと、要素の `src` は
// 文書の基底 URL で解決されるので相対パスが「別オリジン」に見える
// （jsdom でも実ブラウザでも同じ。最初これで嘘の失敗を出した）
const HERE = window.location.origin;
const scriptAt = (src: string) => { const el = document.createElement("script"); el.src = src; return el; };
const sheetAt = (href: string) => { const el = document.createElement("link"); el.rel = "stylesheet"; el.href = href; return el; };

describe("isAssetElement（リロード対象の判定）", () => {
    it("自分のサイトの script の失敗は対象", () => {
        expect(isAssetElement(scriptAt(`${HERE}/_next/static/chunks/a.js`), HERE)).toBe(true);
    });
    it("自分のサイトの stylesheet の失敗は対象", () => {
        expect(isAssetElement(sheetAt(`${HERE}/_next/static/chunks/a.css`), HERE)).toBe(true);
    });

    /**
     * **別オリジンは対象にしない。**
     *
     * ここが「`<script>` なら何でも」だったので、**広告ブロッカーが解析タグを
     * 落とすだけでページが自分でリロードしていた**。実ブラウザで A/B して確認:
     *
     *     GA が通る      読み込み 1回 / リロードの印 なし
     *     GA をブロック   読み込み 2回 / リロードの印 あり
     *
     * 解析タグが落ちてもページは壊れない。この仕組みが直すのは
     * 「CSS/JS チャンクが来なくて画面が壊れた」場合で、それは必ず同じオリジン。
     */
    it("別オリジンの script（解析タグなど）は対象外", () => {
        expect(isAssetElement(scriptAt("https://www.googletagmanager.com/gtag/js?id=G-X"), HERE)).toBe(false);
        expect(isAssetElement(scriptAt("https://plausible.io/js/script.js"), HERE)).toBe(false);
    });
    it("別オリジンの stylesheet も対象外", () => {
        expect(isAssetElement(sheetAt("https://cdn.example.com/a.css"), HERE)).toBe(false);
    });
    it("相対パスは自分のサイトとして扱う", () => {
        expect(isAssetElement(scriptAt("/_next/static/chunks/a.js"), HERE)).toBe(true);
    });
    it("インラインの script（src 無し）は対象外", () => {
        expect(isAssetElement(document.createElement("script"), HERE)).toBe(false);
    });
    // オリジンが分からないときは「何もしない」に倒す（勝手にリロードしない）
    it("オリジンが分からなければ対象外", () => {
        expect(isAssetElement(scriptAt("/a.js"), "")).toBe(false);
    });
    it("stylesheet 以外の link は対象外", () => {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = `${HERE}/favicon.ico`;
        expect(isAssetElement(link, HERE)).toBe(false);
    });
    it("画像の読み込み失敗ではリロードしない（写真の404は正常系にあり得る）", () => {
        const img = document.createElement("img");
        img.src = `${HERE}/uploads/a.jpg`;
        expect(isAssetElement(img, HERE)).toBe(false);
    });
    it("window 起因のJSエラー（target無し）は対象外", () => {
        expect(isAssetElement(null, HERE)).toBe(false);
        expect(isAssetElement(window, HERE)).toBe(false);
    });
});

describe("shouldAutoReload / markReloaded（リロードループ防止）", () => {
    let storage: Storage;
    beforeEach(() => { storage = makeStorage(); });

    it("初回はリロードしてよい", () => {
        expect(shouldAutoReload(1_000_000, storage)).toBe(true);
    });

    it("直後の再失敗ではリロードしない（無限ループ防止）", () => {
        markReloaded(1_000_000, storage);
        expect(shouldAutoReload(1_000_000 + 5_000, storage)).toBe(false);
    });

    it("クールダウン経過後は再びリロードできる", () => {
        markReloaded(1_000_000, storage);
        expect(shouldAutoReload(1_000_000 + 61_000, storage)).toBe(true);
    });

    it("storage が使えない環境ではリロードしない（安全側）", () => {
        expect(shouldAutoReload(1_000_000, null)).toBe(false);
    });
});

describe("stylesheetsApplied", () => {
    function docWith(links: Array<{ rel: string; sheet: unknown }>): Document {
        return {
            querySelectorAll: (sel: string) =>
                (sel.includes("stylesheet") ? links.filter((l) => l.rel.split(/\s+/).includes("stylesheet")) : []) as unknown as NodeListOf<HTMLLinkElement>,
        } as unknown as Document;
    }

    it("外部CSSが無いページは対象外（true）", () => {
        expect(stylesheetsApplied(docWith([]))).toBe(true);
    });

    it("規則が読み込まれていれば true", () => {
        expect(stylesheetsApplied(docWith([{ rel: "stylesheet", sheet: { cssRules: { length: 42 } } }]))).toBe(true);
    });

    it("読み込みに失敗（sheet が null）なら false", () => {
        expect(stylesheetsApplied(docWith([{ rel: "stylesheet", sheet: null }]))).toBe(false);
    });

    it("200で中身が空（規則ゼロ）でも false", () => {
        expect(stylesheetsApplied(docWith([{ rel: "stylesheet", sheet: { cssRules: { length: 0 } } }]))).toBe(false);
    });

    it("1つでも当たっていれば true（他が失敗していても）", () => {
        expect(stylesheetsApplied(docWith([
            { rel: "stylesheet", sheet: null },
            { rel: "stylesheet", sheet: { cssRules: { length: 3 } } },
        ]))).toBe(true);
    });

    it("クロスオリジンで規則を読めない場合は成功扱い（true）", () => {
        const crossOrigin = { get cssRules() { throw new Error("SecurityError"); } };
        expect(stylesheetsApplied(docWith([{ rel: "stylesheet", sheet: crossOrigin }]))).toBe(true);
    });
});
