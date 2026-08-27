import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ハイドレーション・ウォッチドッグ（app/layout.tsx の <head> 内インラインJS）。
// 12秒たっても data-hydrated が付かなければ SW とキャッシュを捨てて1回だけ
// 再読込する。ループ防止のクールダウンの控えを **localStorage** に置いていた。
// localStorage は全タブ共有なので、1つのタブが自己修復すると、同じく
// 壊れている2つ目以降のタブは最大10分そのまま操作できなかった。
// すぐ上の資産チェック（jp_asset_reload_at）は最初から sessionStorage で、
// そちらが正しい形。タブごとの控え（sessionStorage）に揃える。

/** layout.tsx から、ウォッチドッグのインラインJSを取り出す */
function watchdogSource(): string {
    const src = readFileSync(resolve(process.cwd(), "app/layout.tsx"), "utf8");
    const m = src.match(/__html: `(\(function\(\)\{try\{var K="jp_hydrate_recover_at";[\s\S]*?)`,/);
    if (!m) throw new Error("ウォッチドッグのスクリプトが見つからない");
    return m[1];
}

let reloads = 0;

beforeEach(() => {
    vi.useFakeTimers();
    reloads = 0;
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-hydrated");
    Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, reload: () => { reloads++; } },
    });
});
afterEach(() => {
    vi.useRealTimers();
});

/** スクリプトを走らせ、load → 12秒 → 修復の後始末まで進める */
async function runWatchdog() {
    new Function(watchdogSource())();
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(3_100);   // Promise.all の保険 setTimeout
}

describe("ハイドレーション・ウォッチドッグのクールダウン", () => {
    it("控えはタブごと（sessionStorage）に書く。全タブ共有の localStorage は使わない", async () => {
        await runWatchdog();

        expect(reloads).toBe(1);
        expect(sessionStorage.getItem("jp_hydrate_recover_at")).not.toBeNull();
        // ここが localStorage だと、別のタブが同じ10分間だけ救済されない
        expect(localStorage.getItem("jp_hydrate_recover_at")).toBeNull();
    });

    it("同じタブでは10分間もう一度走らない（ループ防止は効いたまま）", async () => {
        sessionStorage.setItem("jp_hydrate_recover_at", String(Date.now()));
        await runWatchdog();
        expect(reloads).toBe(0);
    });

    it("別のタブが自己修復済みでも、こちらのタブは救済される", async () => {
        // 「別のタブ」の控えは localStorage には残らないので、
        // 仮にそこに値があってもこちらは止まらない
        localStorage.setItem("jp_hydrate_recover_at", String(Date.now()));
        await runWatchdog();
        expect(reloads).toBe(1);
    });

    it("水和できていれば発火しない", async () => {
        document.documentElement.setAttribute("data-hydrated", "1");
        await runWatchdog();
        expect(reloads).toBe(0);
        expect(sessionStorage.getItem("jp_hydrate_recover_at")).toBeNull();
    });
});
