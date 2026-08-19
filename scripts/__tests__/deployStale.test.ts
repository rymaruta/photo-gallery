import { describe, it, expect } from "vitest";
// デプロイスクリプトの「古いオブジェクト削除」判定。
// 外部ブラウザで CSS/JS が 404 になり画面が崩れる事故の再発防止ガード。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyStaleObjects, ASSET_GRACE_MS } = require("../deploy-static-site.js") as {
    classifyStaleObjects: (
        localKeys: string[],
        remoteObjects: Array<{ key: string; lastModified?: Date }>,
        now: number,
        graceMs: number,
    ) => { toDelete: string[]; kept: number };
    ASSET_GRACE_MS: number;
};

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("classifyStaleObjects（デプロイ時の削除判定）", () => {
    it("今回のビルドに含まれるファイルは絶対に削除しない", () => {
        const { toDelete } = classifyStaleObjects(
            ["_next/static/chunks/app.js", "index.html"],
            [
                { key: "_next/static/chunks/app.js", lastModified: new Date(NOW - 100 * DAY) },
                { key: "index.html", lastModified: new Date(NOW - 100 * DAY) },
            ],
            NOW,
            ASSET_GRACE_MS,
        );
        expect(toDelete).toEqual([]);
    });

    it("ビルドに無い古いHTMLは即削除される（no-store配信のため安全）", () => {
        const { toDelete } = classifyStaleObjects(
            ["index.html"],
            [{ key: "photo/old-page.html", lastModified: new Date(NOW - 1000) }],
            NOW,
            ASSET_GRACE_MS,
        );
        expect(toDelete).toEqual(["photo/old-page.html"]);
    });

    it("ビルドに無いJS/CSSは猶予期間内なら保持される（古いHTMLを持つ端末の404防止）", () => {
        const { toDelete, kept } = classifyStaleObjects(
            ["index.html"],
            [
                { key: "_next/static/chunks/old-hash.js", lastModified: new Date(NOW - 1 * DAY) },
                { key: "_next/static/css/old-hash.css", lastModified: new Date(NOW - 29 * DAY) },
            ],
            NOW,
            ASSET_GRACE_MS,
        );
        expect(toDelete).toEqual([]);
        expect(kept).toBe(2);
    });

    it("猶予期間を過ぎたアセットは削除される", () => {
        const { toDelete } = classifyStaleObjects(
            ["index.html"],
            [{ key: "_next/static/chunks/ancient.js", lastModified: new Date(NOW - 31 * DAY) }],
            NOW,
            ASSET_GRACE_MS,
        );
        expect(toDelete).toEqual(["_next/static/chunks/ancient.js"]);
    });

    it("lastModified 不明のアセットは古い扱いで削除される", () => {
        const { toDelete } = classifyStaleObjects(
            ["index.html"],
            [{ key: "_next/static/chunks/unknown.js" }],
            NOW,
            ASSET_GRACE_MS,
        );
        expect(toDelete).toEqual(["_next/static/chunks/unknown.js"]);
    });

    it("猶予期間は30日以上ある（短くすると外部ブラウザ事故が再発する）", () => {
        expect(ASSET_GRACE_MS).toBeGreaterThanOrEqual(30 * DAY);
    });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { invalidationPathsFor } = require("../deploy-static-site.js");

// 以前は毎回 "/*" を無効化していた。写真も同じディストリビューションから
// 配信していて max-age=31536000 を付けているのに、push と1日4回の定期ビルドの
// たびに全写真をエッジから追い出しており、長いキャッシュが無意味になっていた。
describe("invalidationPathsFor", () => {
    it("写真（uploads/）は絶対に含めない", () => {
        const paths = invalidationPathsFor([
            "index.html", "photo/abc.html", "tag/winter.html", "sitemap.xml",
        ]);
        expect(paths).not.toContain("/*");
        expect(paths.some((p: string) => p.startsWith("/uploads"))).toBe(false);
    });

    it("ハッシュ付きアセットは無効化しない（内容が変われば名前も変わる）", () => {
        const paths = invalidationPathsFor(["_next/static/chunks/main-abc123.js", "index.html"]);
        expect(paths.some((p: string) => p.startsWith("/_next"))).toBe(false);
    });

    it("HTML とキャッシュさせないファイルは無効化する", () => {
        const paths = invalidationPathsFor([
            "index.html", "photo/abc.html", "sitemap.xml", "sw.js", "robots.txt",
        ]);
        const covers = (url: string) =>
            paths.some((p: string) => p === url || (p.endsWith("*") && url.startsWith(p.slice(0, -1))));
        expect(covers("/")).toBe(true);
        expect(covers("/photo/abc.html")).toBe(true);
        expect(covers("/sitemap.xml")).toBe(true);
        expect(covers("/sw.js")).toBe(true);
        expect(covers("/robots.txt")).toBe(true);
    });

    it("先頭の名前でまとめる（パス数＝課金単位を抑える）", () => {
        const paths = invalidationPathsFor([
            "users.html", "users.txt", "users/a.html", "users/b.html", "users/search.html",
        ]);
        expect(paths).toEqual(["/", "/users*"]);
    });

    it("uploads/ を巻き込む入力は例外にする（安全側に倒す）", () => {
        expect(() => invalidationPathsFor(["uploads/a.html"])).toThrow(/uploads/);
    });
});
