import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";

/**
 * 🔴 **ロゴの画像を先読みしない**（2026-10-22）。
 *
 * React は `loading="lazy"` でも `fetchPriority="low"` でもない `<img>` を `<head>` の
 * `<link rel="preload" as="image">` に上げる。本番の全ページで `/logo-aperture.png` の先読みが
 * 代表写真（LCP）の先読みより前に出て、帯域を取り合っていた。
 */
describe("ロゴの先読み", () => {
    it("ヘッダーのロゴの <img> は fetchPriority=\"low\"", () => {
        const src = readFileSync(join(__dirname, "../layout.tsx"), "utf8");
        const img = /<img src="\/logo-aperture\.png"[^>]*>/.exec(src)?.[0] ?? "";
        expect(img, "ロゴの <img> が見つからない").not.toBe("");
        expect(img).toContain('fetchPriority="low"');
        expect(img).not.toContain('loading="lazy"');
    });

    it("（前提の確かめ）React は fetchPriority=\"low\" の画像を先読みに上げない・代表写真の先読みは残る", () => {
        const page = (logo: Record<string, string>) => renderToString(
            <html><head /><body>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-aperture.png" alt="" {...logo} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/hero.jpg" alt="代表写真" fetchPriority="high" />
            </body></html>,
        );
        expect(page({})).toContain('<link rel="preload" as="image" href="/logo-aperture.png"/>');
        const fixed = page({ fetchPriority: "low" });
        expect(fixed).not.toMatch(/rel="preload"[^>]*logo-aperture/);
        expect(fixed).toMatch(/rel="preload"[^>]*hero\.jpg/);
    });
});
