import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gotoSettled } from "../lib/smokeGoto.mjs";

/**
 * スモークの頁の移動（`scripts/lib/smokeGoto.mjs`）。2026-10-31 の Deploy Site で、WebKit が
 * 前の頁の読み込みの残りに次の `goto` を「割り込まれた」と言って落ちた形を、偽の Page で再現する
 */
function fakePage({ pendingLoad = false, interruptOnce = false } = {}) {
    const log: string[] = [];
    let loading = pendingLoad;
    let interrupt = interruptOnce;
    return {
        log,
        async waitForLoadState(state: string) {
            log.push(`wait:${state}`);
            loading = false;
        },
        async goto(url: string) {
            log.push(`try:${url}`);
            // WebKit の形: 前の頁の読み込みが残っていると、後から来た移動が割り込まれた扱いになる
            if (loading) throw new Error(`page.goto: Navigation to "${url}" is interrupted by another navigation to "http://localhost:4173/"`);
            if (interrupt) {
                interrupt = false;
                loading = true; // 頁が自分で読み直しを始めた
                throw new Error(`page.goto: Navigation to "${url}" is interrupted by another navigation to "http://localhost:4173/"`);
            }
            log.push(`ok:${url}`);
            return null;
        },
    };
}

describe("gotoSettled（前の頁の移動が終わってから次へ）", () => {
    it("前の頁の読み込みが残っていても、load を待ってから行くので割り込まれない", async () => {
        const page = fakePage({ pendingLoad: true });
        await gotoSettled(page, "/location/a");
        expect(page.log).toEqual(["wait:load", "try:/location/a", "ok:/location/a"]);
    });

    it("頁が自分で起こした移動に割り込まれたら、その load を待って一度だけ行き直す", async () => {
        const page = fakePage({ interruptOnce: true });
        await gotoSettled(page, "/location/a");
        expect(page.log).toEqual(["wait:load", "try:/location/a", "wait:load", "try:/location/a", "ok:/location/a"]);
    });

    it("割り込み以外の失敗はそのまま投げる（隠さない）", async () => {
        const page = {
            async waitForLoadState() {},
            async goto() { throw new Error("net::ERR_CONNECTION_REFUSED"); },
        };
        await expect(gotoSettled(page, "/x")).rejects.toThrow("ERR_CONNECTION_REFUSED");
    });

    it("スモークの移動は全部この口を通る（直に page.goto を呼ぶ所を残さない）", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "e2e-smoke.mjs"), "utf8");
        expect(src).toMatch(/import \{ gotoSettled \} from "\.\/lib\/smokeGoto\.mjs"/);
        expect(src.match(/\b(page|dpage)\.goto\(/g) ?? []).toEqual([]);
        expect((src.match(/gotoSettled\(/g) ?? []).length).toBeGreaterThanOrEqual(20);
    });
});
