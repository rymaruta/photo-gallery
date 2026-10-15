import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RING_UNSEEN, RING_SEEN } from "../ring";

/**
 * ストーリーの未見の輪は**真鍮の金属の光**（iOS v2 の `WebTheme.accentMetal`・板の `.ring`）。
 * 単色の真鍮（v1）に戻ると落ちる。色の値は `globals.css` の `@theme` だけが持つ。
 */
describe("ストーリーの輪の色", () => {
    it("未見は暗い端 → 明るい端 → 真鍮 → 暗い端を円周に回す", () => {
        expect(RING_UNSEEN).toBe(
            "conic-gradient(from 210deg, var(--color-accent-lo), var(--color-accent-hi), var(--color-accent), var(--color-accent-lo))",
        );
    });

    it("使っている色は @theme に在り、iOS の値と同じ（#9A7A45・#F3DCA6・#C9A66B）", () => {
        const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
        const val = (n: string) => new RegExp(`--color-${n}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1]?.toLowerCase();
        expect(val("accent-lo")).toBe("#9a7a45");
        expect(val("accent-hi")).toBe("#f3dca6");
        expect(val("accent")).toBe("#c9a66b");
        for (const v of RING_UNSEEN.match(/--color-[a-z-]+/g) ?? []) {
            expect(css, `${v} が globals.css に無い`).toContain(`${v}:`);
        }
    });

    it("見た輪は灰のまま（金属の光は未見の合図だけ）", () => {
        expect(RING_SEEN).toBe("var(--color-outline)");
    });
});
