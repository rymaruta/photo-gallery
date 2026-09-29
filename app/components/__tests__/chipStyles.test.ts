import { describe, it, expect } from "vitest";
import { CHIP_ON, CHIP_OFF } from "../chipStyles";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * チップの定数そのもの。**使う側のテストでは定数の中身を見張れない**——FilterBar は以前
 * 自分でも `focus:outline-none` を書いていて、定数から外してもテストが通った。
 */
describe("chipStyles", () => {
    const cls = (s: string) => s.split(/\s+/);

    it("どちらもブラウザ既定の輪を消し、内側 2px の輪を持つ（二重の輪にしない）", () => {
        for (const c of [CHIP_ON, CHIP_OFF]) {
            expect(cls(c)).toEqual(expect.arrayContaining(["focus:outline-hidden", "ring-inset", "focus-visible:ring-2"]));
            // outline-none だと forced-colors（ハイコントラスト）でフォーカスの印が何も残らない
            expect(cls(c)).not.toContain("focus:outline-none");
            // forced-colors の outline を内側へ（外側だと横スクロールの行で上下が切れる）
            expect(cls(c)).toContain("focus:-outline-offset-2");
        }
    });

    it("輪の色は、非選択が真鍮・選択中が墨（白い地で真鍮は 1.93:1）", () => {
        expect(cls(CHIP_OFF)).toContain("focus-visible:ring-accent");
        expect(cls(CHIP_ON)).toContain("focus-visible:ring-ink");
        expect(cls(CHIP_ON)).not.toContain("focus-visible:ring-accent");
    });

    it("iOS の色: 非選択は bg-chip＋白12%の縁＋chip-text、選択中は primary＋墨の600", () => {
        expect(cls(CHIP_OFF)).toEqual(expect.arrayContaining(["bg-chip", "text-chip-text", "ring-1", "ring-line"]));
        expect(cls(CHIP_ON)).toEqual(expect.arrayContaining(["bg-primary", "text-ink", "font-semibold"]));
    });

    it("使う側で focus:outline-none を足していない（後に並んで forced-colors の輪を消す）", () => {
        const root = join(__dirname, "../..");
        const files: string[] = [];
        const walk = (d: string) => {
            for (const n of readdirSync(d)) {
                const p = join(d, n);
                if (statSync(p).isDirectory()) { if (n !== "__tests__" && n !== "node_modules") walk(p); }
                else if (n.endsWith(".tsx")) files.push(p);
            }
        };
        walk(root);
        const bad: string[] = [];
        let uses = 0;
        for (const f of files) {
            readFileSync(f, "utf8").split("\n").forEach((line, i) => {
                if (!/\bCHIP_(ON|OFF)\b/.test(line) || /^\s*import\b/.test(line)) return;
                uses++;
                if (/focus:outline-none/.test(line)) bad.push(`${f}:${i + 1}`);
            });
        }
        expect(uses, "定数を使う行を1つも拾えていない").toBeGreaterThan(5);
        expect(bad).toEqual([]);
    });
});
