import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAssetElement, stylesheetsApplied } from "@/lib/utils/assetRecovery";

/**
 * **同じ規則が2か所にある。**
 *
 *   `<head>` のインラインスクリプト（`app/layout.tsx`）… チャンクより先に動く
 *   `lib/utils/assetRecovery.ts` の `isAssetElement` … React の部品から
 *
 * 写しが要るのは、**`<head>` の時点の失敗は React の部品では拾えない**ため。
 *
 * **一度ずれた。** 「`<script>` なら何でも」だったのを `isAssetElement` だけ
 * 同一オリジンに絞ったが、**先に登録されるインライン側が発火し続けていた**
 * ——実ブラウザで測って気づいた:
 *
 *     解析タグ（別オリジン）を落とす   直す前 読み込み2回 / 直した後 1回
 *     自分の CSS を落とす              どちらも 2回（本来の目的は保たれている）
 *
 * ここでは**インラインのソースを実際に走らせて**、2つが同じ答えを出すことを見る。
 */
const KEY = "jp_asset_reload_at";
const HERE = window.location.origin;

/** `app/layout.tsx` に埋め込まれているスクリプトの本体を取り出す */
function inlineSource(): string {
    const src = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    const m = /__html: `(\(function\(\)\{try\{var KEY="jp_asset_reload_at"[\s\S]*?)`,/.exec(src);
    if (!m) throw new Error("インラインの見張りが見つからない（layout.tsx の形が変わった）");
    return m[1];
}

function runInline() {
    // `location.reload()` は jsdom で未実装。印は reload の**前**に付くので判定に影響しない
    new Function(inlineSource())();
}

const el = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    document.body.appendChild(e);
    return e;
};

/** インライン側が「リロードする」と判断したか */
function inlineFires(target: Element): boolean {
    sessionStorage.removeItem(KEY);
    target.dispatchEvent(new Event("error"));
    return sessionStorage.getItem(KEY) !== null;
}

beforeEach(() => {
    document.body.innerHTML = "";
    // **`<head>` も掃除する。** ここを忘れると前のテストが足した
    // `<link rel=stylesheet>` が残り、「規則が0なら直す」の判定が
    // 前のテストの CSS を見て通ってしまう（自分で踏んだ）
    document.head.querySelectorAll("link").forEach((l) => l.remove());
    sessionStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => { });
});

describe("`<head>` の見張りと `isAssetElement` が同じ判断をする", () => {
    const cases: [name: string, make: () => Element, expected: boolean][] = [
        ["自分の JS チャンク", () => el("script", { src: `${HERE}/_next/static/chunks/a.js` }), true],
        ["自分の CSS", () => el("link", { rel: "stylesheet", href: `${HERE}/_next/static/chunks/a.css` }), true],
        ["解析タグ（別オリジン）", () => el("script", { src: "https://www.googletagmanager.com/gtag/js?id=G-X" }), false],
        ["Plausible（別オリジン）", () => el("script", { src: "https://plausible.io/js/script.js" }), false],
        ["別オリジンの CSS", () => el("link", { rel: "stylesheet", href: "https://cdn.example.com/a.css" }), false],
        ["stylesheet でない link", () => el("link", { rel: "icon", href: `${HERE}/favicon.ico` }), false],
        ["画像", () => el("img", { src: `${HERE}/uploads/a.jpg` }), false],
        ["インラインの script（src 無し）", () => el("script", {}), false],
    ];

    it.each(cases)("%s", (_name, make, expected) => {
        runInline();
        const target = make();
        expect(inlineFires(target), "インラインの見張りの判断が違う").toBe(expected);
        expect(isAssetElement(target, HERE), "isAssetElement の判断が違う").toBe(expected);
    });

    // **取り出しが空振りしていないこと。** 正規表現が外れると「何も走らせずに
    // 全部 false」で通ってしまう（台帳が何度も踏んだ形）
    it("インラインのソースを実際に取り出せている", () => {
        const src = inlineSource();
        expect(src.length).toBeGreaterThan(400);
        expect(src).toContain("jp_asset_reload_at");
        expect(src).toContain("location.reload");
    });
});

/**
 * **写しのもう半分。**
 *
 * 見張りは2つの入口を持つ:
 *   `error` イベント          … 上の `isAssetElement`
 *   `load` 後の CSS の当たり具合 … こちら（`stylesheetsApplied`）
 *
 * `eccc8779` では前半しか突き合わせていなかった。片方の写しだけ触れば、
 * また静かにずれる（この周で2回踏んだ型）。
 *
 * `error` だけに頼ると取りこぼす経路が2つある、というのがこの入口の理由:
 *   `<link rel=stylesheet>` は `<head>` の先頭に置かれるので、
 *   見張りが動く前に失敗しうる／CDN が 200 + HTML を返すと error にならない。
 */
/** jsdom は実際に CSS を読み込まないので `sheet` を差し込む */
function sheetEl(rules: number | "throws" | null): HTMLLinkElement {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${HERE}/a.css`;
    document.head.appendChild(link);
    const value = rules === null ? null
        : rules === "throws"
            ? { get cssRules(): never { throw new DOMException("cross-origin", "SecurityError"); } }
            : { cssRules: { length: rules } };
    Object.defineProperty(link, "sheet", { configurable: true, value });
    return link;
}

/** インライン側が `load` 後に「リロードする」と判断したか */
function inlineFiresOnLoad(): boolean {
    sessionStorage.removeItem(KEY);
    window.dispatchEvent(new Event("load"));
    return sessionStorage.getItem(KEY) !== null;
}

describe("CSS が当たっているかの判定も、2つの写しで同じ", () => {
    const cases: [name: string, setup: () => void, reload: boolean][] = [
        ["外部CSSが無いページ", () => { }, false],
        ["規則が当たっている", () => { sheetEl(125); }, false],
        ["規則が0（200 + HTML を掴んだ形）", () => { sheetEl(0); }, true],
        ["読み込みに失敗（sheet が無い）", () => { sheetEl(null); }, true],
        ["別オリジンで規則を読めない（＝読み込みは成功）", () => { sheetEl("throws"); }, false],
        ["1枚は駄目でも1枚当たっていれば良い", () => { sheetEl(0); sheetEl(125); }, false],
    ];

    it.each(cases)("%s", (_name, setup, reload) => {
        runInline();
        setup();
        expect(inlineFiresOnLoad(), "インラインの見張りの判断が違う").toBe(reload);
        // モジュール側は「当たっているか」を返すので、リロードするかは否定
        expect(stylesheetsApplied(document), "stylesheetsApplied の判断が違う").toBe(!reload);
    });
});

