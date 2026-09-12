import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAssetElement } from "@/lib/utils/assetRecovery";

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
