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

    it("使う側で輪を消す・ずらす指定を足していない（後に並んで forced-colors の輪を消す）", () => {
        // **同じ行だけでは足りない**: className を複数行に分ける書き方（SpotIndexClient）と、
        // 定数を別名に包む書き方（PhotoPageClient の CHIP_CLASS）がある。定数や別名を使う行の
        // 前後 3 行を見る。`focus-visible:outline-none` や `outline-0`・offset の上書きも同じ害
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
        const USE = /\b(CHIP_ON|CHIP_OFF|CHIP_CLASS)\b/;
        const KILL = /(^|[\s"'`])(focus|focus-visible):(outline-none|outline-0|-?outline-offset-)/;
        const bad: string[] = [];
        let uses = 0;
        for (const f of files) {
            const lines = readFileSync(f, "utf8").split("\n");
            lines.forEach((line, i) => {
                if (!USE.test(line) || /^\s*import\b/.test(line)) return;
                uses++;
                for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
                    if (KILL.test(lines[j])) bad.push(`${f}:${j + 1}`);
                }
            });
        }
        expect(uses, "定数を使う行を1つも拾えていない").toBeGreaterThan(5);
        expect([...new Set(bad)]).toEqual([]);
    });
});
