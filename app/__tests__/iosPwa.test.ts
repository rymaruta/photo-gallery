import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ホーム画面から起動したアプリ（PWA）まわり（docs/ios-bug-audit-2026-09-25.md #9・#17）。
 */
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("#9 オフラインの受け皿", () => {
    it("同じ URL を開き直す道がある（ホーム画面のアプリにはアドレスバーも更新の操作も無い）", () => {
        const html = read("public/offline.html").replace(/<!--[\s\S]*?-->/g, "");
        expect(html).toMatch(/<a href="">[^<]+<\/a>/);
        // 受け皿は JavaScript を使わない（水和も要らない形のまま）
        expect(html).not.toMatch(/<script/i);
    });
});

describe("#17 Service Worker の更新", () => {
    it("戻ってきたとき（visibilitychange）に registration.update() で確かめる", () => {
        const src = read("app/components/ServiceWorkerRegister.tsx").replace(/\/\/[^\n]*/g, "");
        expect(src).toMatch(/addEventListener\("visibilitychange"/);
        expect(src).toMatch(/\.update\(\)/);
    });
});
