import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { siteConfig } from "@/lib/utils/seo";

/**
 * **検索から来た人をアプリへつなぐ**（Smart App Banner・2026-10-07）。
 * iPhone の Safari が `<meta name="apple-itunes-app" content="app-id=…">` を見て、
 * ページ上部に「開く／入手」の帯を出す。Next は metadata の `itunes` からこのタグを書く。
 */
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Smart App Banner", () => {
    it("App Store の App ID は数字だけ（違う形だと Safari は帯を出さない）", () => {
        expect(siteConfig.iosAppId).toMatch(/^\d{9,10}$/);
    });

    it("ルートの metadata が itunes.appId に App ID を渡している", () => {
        const src = read("app/layout.tsx").replace(/\/\/[^\n]*/g, "");
        expect(src).toMatch(/itunes:\s*\{\s*appId:\s*siteConfig\.iosAppId\s*\}/);
    });

    it("子のページが itunes を上書きしていない（書くと帯が消える・ずれる）", () => {
        const pages = fs.readdirSync(path.join(root, "app"), { recursive: true })
            .map(String)
            .filter((f) => /(page|layout)\.tsx?$/.test(f) && f !== "layout.tsx");
        const overriding = pages.filter((f) => /\bitunes\s*:/.test(read(path.join("app", f))));
        expect(overriding).toEqual([]);
    });
});
