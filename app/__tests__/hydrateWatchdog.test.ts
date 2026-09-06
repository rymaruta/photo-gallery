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
    // 既定はオンライン（jsdom の navigator.onLine は true）
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
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


// 後片付け（SW 解除・キャッシュ全消し）には最大3秒かかる。その間に水和が
// 終わっても無条件に再読込していたので、**遅い回線で入力中の内容が消えた**
// （アップロード画面のタイトル・キャプション）。間に合ったなら戻さない。
// **sessionStorage が使えない端末で、毎回の読み込みで再読込が走っていた。**
//
// クールダウンの読み書きは `catch(e){}` で握るだけなので、投げる環境では
// `last` が 0 のまま・控えも残らない ＝ **10分の歯止めが一度も効かない**。
// しかも再読込の前に Service Worker を解除して Cache Storage を全消しするので、
// 水和できない状態が続く限り、読み込むたびにオフラインの控えごと捨てられる。
// すぐ上の資産チェック（`jp_asset_reload_at`）は同じ状況で `catch(x){return}`
// して諦めており、**同じファイルの隣り合った2つで倒し方が逆**だった。
describe("sessionStorage が使えないとき", () => {
    // **差し替えを閉じ込める。** `window.sessionStorage` を投げる形にしたまま
    // 抜けると、外側の beforeEach の `sessionStorage.clear()` が投げて
    // **このファイルの残り全部が落ちる**（実際に一度そうなった）
    let original: PropertyDescriptor | undefined;
    afterEach(() => {
        if (original) Object.defineProperty(window, "sessionStorage", original);
        original = undefined;
    });

    /** 読み書きが必ず投げる sessionStorage にする（プライベートモード相当） */
    function blockSessionStorage() {
        original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
        const throwing = {
            getItem() { throw new DOMException("blocked", "SecurityError"); },
            setItem() { throw new DOMException("blocked", "SecurityError"); },
            removeItem() { throw new DOMException("blocked", "SecurityError"); },
            clear() { throw new DOMException("blocked", "SecurityError"); },
            key() { return null; },
            length: 0,
        };
        Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => throwing });
    }

    it("記録できないなら再読込しない（読み込みのたびのループにしない）", async () => {
        blockSessionStorage();
        // 5回ぶん読み込む（同じタブで水和が失敗し続けている状態）
        for (let i = 0; i < 5; i++) await runWatchdog();

        expect(reloads, "読み込みのたびに再読込している（SWとキャッシュも毎回消える）").toBe(0);
    });

    // **読みだけが投げる場合も止める。** 書き込みは通るので控えは残るが、
    // 次の読み込みで読めなければ `last` は 0 のまま＝クールダウンは効かず、
    // やはり毎回走る。書き込み側の `return` だけでは塞げない（変異で確認:
    // 読みの守りを外すとこのテストだけが落ちる）
    it("読めないだけでも再読込しない", async () => {
        const throwingRead = {
            getItem() { throw new DOMException("blocked", "SecurityError"); },
            setItem() { /* 書けはする */ },
            removeItem() { }, clear() { }, key() { return null; }, length: 0,
        };
        original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
        Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => throwingRead });

        for (let i = 0; i < 3; i++) await runWatchdog();
        expect(reloads, "読めないのに走っている（次の読み込みでも同じ）").toBe(0);
    });

    // **読めるが書けない端末も止める**（iOS Safari のプライベートモードの
    // 古典的な形）。読みの守りが先に効くので、書き込み側の `return` は
    // このファイルのどのテストでも通っていなかった——**戻しても全部緑**
    // だった（レビューが変異で実測）。控えが残らない以上、次の読み込みでも
    // やはり走る
    it("読めるが書けない端末でも再読込しない", async () => {
        const store: Record<string, string> = {};
        const readOnly = {
            getItem: (k: string) => store[k] ?? null,
            setItem() { throw new DOMException("full", "QuotaExceededError"); },
            removeItem() { }, clear() { }, key() { return null; }, length: 0,
        };
        original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
        Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => readOnly });

        for (let i = 0; i < 3; i++) await runWatchdog();
        expect(reloads, "書けないのに毎回走っている").toBe(0);
    });

    // 正常な端末では今までどおり1回だけ走る（諦める側に倒しすぎない）
    it("使える端末では今までどおり1回だけ走る", async () => {
        for (let i = 0; i < 5; i++) await runWatchdog();
        expect(reloads).toBe(1);
    });
});

describe("後片付けの最中に水和が終わったら", () => {
    /**
     * 後片付け（SW 解除・キャッシュ全消し）を**保留にできる**世界を作る。
     * jsdom には serviceWorker も caches も無く、素だと Promise.all が
     * 即座に解決して go() が12秒の直後に走る——**実ブラウザの順序
     * （片付けに数秒かかる）を再現できない**ので、変更の有無で結果が
     * 変わらなかった（最初これで書いて空振りした）。
     */
    function pendingCleanup() {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        Object.defineProperty(navigator, "serviceWorker", {
            configurable: true,
            value: { getRegistrations: () => gate.then(() => []) },
        });
        Object.defineProperty(window, "caches", {
            configurable: true,
            value: { keys: () => gate.then(() => []), delete: async () => true },
        });
        return release;
    }

    it("再読込しない（入力中の内容を捨てない）", async () => {
        const release = pendingCleanup();
        new Function(watchdogSource())();
        window.dispatchEvent(new Event("load"));
        await vi.advanceTimersByTimeAsync(12_000);
        expect(reloads).toBe(0);   // まだ片付けの最中

        // ここで React が追いついた → 片付けが終わっても戻さない
        document.documentElement.setAttribute("data-hydrated", "1");
        release();
        await vi.advanceTimersByTimeAsync(3_100);

        expect(reloads).toBe(0);
    });

    it("追いつかなければ今までどおり再読込する", async () => {
        const release = pendingCleanup();
        new Function(watchdogSource())();
        window.dispatchEvent(new Event("load"));
        await vi.advanceTimersByTimeAsync(12_000);
        release();
        await vi.advanceTimersByTimeAsync(3_100);

        expect(reloads).toBe(1);
    });
});


// **オフラインでは発火させない。** 通信が無いのに水和しないのは異常ではない
// うえ、ここで Cache Storage を全消しして SW を解除すると**オフライン機能
// ごと消えて、そのままブラウザのエラー画面**になる（オフラインなので
// 再登録も控えの取り直しもできない）。Service Worker が受け皿を持つように
// なって初めて意味を持つ歯止め。
describe("オフラインのとき", () => {
    it("再読込も後片付けもしない", async () => {
        Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
        await runWatchdog();

        expect(reloads).toBe(0);
        // クールダウンの控えも書かない（オンラインに戻ったとき1回目として扱う）
        expect(sessionStorage.getItem("jp_hydrate_recover_at")).toBeNull();
    });

    it("オンラインなら今までどおり発火する", async () => {
        await runWatchdog();
        expect(reloads).toBe(1);
    });
});
