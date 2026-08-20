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
    it("変更が無ければ何も無効化しない（定期ビルドの大半はこれ）", () => {
        expect(invalidationPathsFor([])).toEqual([]);
    });

    it("写真1枚の追加なら、その分だけを消す（写真本体は消さない）", () => {
        const paths = invalidationPathsFor([
            "index.html", "photo/new.html", "sitemap.xml", "app/data/photos.json",
        ]);
        expect(paths).toContain("/");
        expect(paths).toContain("/photo/new.html");
        expect(paths).toContain("/photo/new");       // 拡張子なしのURLでも配信される
        expect(paths).toContain("/sitemap.xml");
        expect(paths).not.toContain("/*");
        expect(paths.some((p: string) => p.startsWith("/uploads"))).toBe(false);
    });

    it("ハッシュ付きアセットは無効化しない（内容が変われば名前も変わる）", () => {
        const paths = invalidationPathsFor(["_next/static/chunks/main-abc123.js", "index.html"]);
        expect(paths.some((p: string) => p.startsWith("/_next"))).toBe(false);
        expect(paths).toEqual(["/"]);
    });

    it("同じディレクトリのページが多ければワイルドカードにまとめる", () => {
        const many = Array.from({ length: 20 }, (_, i) => `photo/p${i}.html`);
        expect(invalidationPathsFor(many)).toEqual(["/photo/*"]);
    });

    it("全ページが変わるビルドでも /* にしない（＝写真を巻き添えにしない）", () => {
        // これが実際のデプロイの姿。generateBuildId はコミットごとに変わり、
        // ビルドIDは全ページの RSC ペイロードに埋まるので、**毎回**全HTMLが変わる。
        // 以前はここで "/*" に落ちていたため、「写真がエッジから消える問題を
        // 直した」はずが、実際のデプロイでは一度も直っていなかった。
        const dirs = ["_not-found", "admin", "category", "favorites", "location",
            "login", "photo", "privacy", "signup", "tag", "user", "users"];
        const files = dirs.flatMap((d) => Array.from({ length: 20 }, (_, i) => `${d}/p${i}.html`));
        const paths = invalidationPathsFor(files);
        expect(paths).not.toContain("/*");
        expect(paths.some((p: string) => p.startsWith("/uploads"))).toBe(false);
        // 各ディレクトリはワイルドカード1本にまとまる
        for (const d of dirs) expect(paths).toContain(`/${d}/*`);
    });

    it("ワイルドカードの枠を超えた分は実パスで消す（/* には落とさない）", () => {
        // 枠は「ページ数の多いディレクトリ」から使う。あふれた分は実パスへ。
        const dirs = Array.from({ length: 20 }, (_, i) => `d${i}`);
        const files = dirs.flatMap((d, di) =>
            // d0 が最多、d19 が最少になるようにする
            Array.from({ length: 40 - di }, (_, i) => `${d}/p${i}.html`));
        const paths = invalidationPathsFor(files);
        expect(paths).not.toContain("/*");
        const wildcards = paths.filter((p: string) => p.endsWith("/*"));
        expect(wildcards.length).toBeLessThanOrEqual(12);
        expect(wildcards).toContain("/d0/*");        // 多い方が枠を取る
        expect(wildcards).not.toContain("/d19/*");   // あふれた分は
        expect(paths).toContain("/d19/p0.html");     // 実パスで消える
    });

    it("uploads/ を巻き込む入力は例外にする（安全側に倒す）", () => {
        expect(() => invalidationPathsFor(["uploads/a.html"])).toThrow(/uploads/);
    });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { changedKeys } = require("../deploy-static-site.js");

// 定期ビルド（1日4回）の多くは前回とまったく同じ出力になる。
// それでも毎回無効化していたので、無効化のパス数（＝課金単位）を無駄に使い、
// "/*" だった頃は写真まで巻き添えでエッジから消していた。
describe("changedKeys", () => {
    const md5 = (file: string) =>
        nodeCrypto.createHash("md5").update(nodeFs.readFileSync(nodePath.join("out", file))).digest("hex");

    // 実ビルド成果物から2つだけ拾う（無ければスキップ）
    const sample = nodeFs.existsSync("out/index.html") ? ["index.html"] : [];

    it.skipIf(sample.length === 0)("中身が同じなら変更なし", () => {
        const remote = sample.map((f) => ({ key: f, etag: `"${md5(f)}"` }));
        expect(changedKeys(sample, remote)).toEqual([]);
    });

    it.skipIf(sample.length === 0)("ETag が違えば変更あり", () => {
        const remote = sample.map((f) => ({ key: f, etag: '"deadbeef"' }));
        expect(changedKeys(sample, remote)).toEqual(sample);
    });

    it.skipIf(sample.length === 0)("リモートに無ければ変更あり（新規ページ）", () => {
        expect(changedKeys(sample, [])).toEqual(sample);
    });

    it("ハッシュ付きアセットは比較対象にしない", () => {
        expect(changedKeys(["_next/static/chunks/main-abc.js"], [])).toEqual([]);
    });
});
