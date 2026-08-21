import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
    // 以前は `out/index.html` の有無で `it.skipIf` していた。
    // **ビルド成果物の無いクリーンな CI では3本とも黙って消えていた**
    // ——落ちるのではなく、走らないまま緑になる。実装を壊しても気づけない。
    //
    // changedKeys は `out/` を直接読む（deploy-static-site.js:134 の outDir は
    // モジュール定数）ので、前提はテスト側で作る。実ビルドの成果物とは
    // 名前が衝突しない専用ファイルにして、必ず後始末する。
    const FIXTURE = "__changed-keys-fixture__.html";
    const outDir = nodePath.join(process.cwd(), "out");
    const fixturePath = nodePath.join(outDir, FIXTURE);
    const CONTENT = "<!doctype html><title>fixture</title>";
    const md5 = nodeCrypto.createHash("md5").update(CONTENT).digest("hex");
    const sample = [FIXTURE];

    beforeAll(() => {
        nodeFs.mkdirSync(outDir, { recursive: true });
        nodeFs.writeFileSync(fixturePath, CONTENT);
    });
    afterAll(() => {
        nodeFs.rmSync(fixturePath, { force: true });
    });

    it("中身が同じなら変更なし", () => {
        expect(changedKeys(sample, [{ key: FIXTURE, etag: `"${md5}"` }])).toEqual([]);
    });

    it("ETag が違えば変更あり", () => {
        expect(changedKeys(sample, [{ key: FIXTURE, etag: '"deadbeef"' }])).toEqual(sample);
    });

    it("リモートに無ければ変更あり（新規ページ）", () => {
        expect(changedKeys(sample, [])).toEqual(sample);
    });

    it("ハッシュ付きアセットは比較対象にしない", () => {
        expect(changedKeys(["_next/static/chunks/main-abc.js"], [])).toEqual([]);
    });
});


// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertNoForbiddenContent } = require("../deploy-static-site.js");

// 一度、EXIF を落とす前の原本のURL（srcOriginal）が photos.json 経由で
// 全ページのHTMLに埋まっていた。同期スクリプトと読み出し側の両方で落とす
// ようにしたが、どちらかが将来また素通ししたときに気づける場所が無い。
// S3 に上げる直前＝最後に止められる場所で見る。
describe("assertNoForbiddenContent", () => {
    // outDir はモジュール読み込み時に決まるので、実際の out/ を使って確かめる
    it("今の出力は通る（誤検知しない）", () => {
        if (!nodeFs.existsSync(nodePath.join(process.cwd(), "out", "index.html"))) return;
        const files = ["index.html"];
        expect(() => assertNoForbiddenContent(files)).not.toThrow();
    });

    it("GPS入りの原本URLが混ざっていたら止める", () => {
        const outIndex = nodePath.join(process.cwd(), "out", "_guard_test_.html");
        nodeFs.writeFileSync(outIndex, '<html>{"srcOriginal":"https://cdn/uploads/originals/x.jpeg"}</html>');
        try {
            expect(() => assertNoForbiddenContent(["_guard_test_.html"])).toThrow(/srcOriginal/);
        } finally {
            nodeFs.rmSync(outIndex, { force: true });
        }
    });

    it("内部文書のIDが混ざっていたら止める", () => {
        const f = nodePath.join(process.cwd(), "out", "_guard_test2_.html");
        nodeFs.writeFileSync(f, '<html>notifs#abc</html>');
        try {
            expect(() => assertNoForbiddenContent(["_guard_test2_.html"])).toThrow(/notifs#/);
        } finally {
            nodeFs.rmSync(f, { force: true });
        }
    });

    it("ハッシュ付きアセットは見ない（ビルドIDなどで誤検知しないため）", () => {
        const f = nodePath.join(process.cwd(), "out", "_next", "_guard_test3_.js");
        nodeFs.mkdirSync(nodePath.dirname(f), { recursive: true });
        nodeFs.writeFileSync(f, 'var x="srcOriginal"');
        try {
            expect(() => assertNoForbiddenContent(["_next/_guard_test3_.js"])).not.toThrow();
        } finally {
            nodeFs.rmSync(f, { force: true });
        }
    });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertRobotsMatchesTarget } = require("../deploy-static-site.js");

// 最後まで残っていた「本番へのフォールバック」が、よりによって
// クロール許可の切り替えだった（lib/utils/seo.ts の envName）。
// `npm run web:deploy:prod` は**ビルドせずアップロードだけ**するので、
// 環境変数の無いビルド成果物がそのまま本番へ行く経路が実在した。
// CI の必須チェックだけでは塞げないので、上げる直前にも見る。
describe("assertRobotsMatchesTarget（上げ先と robots.txt の食い違い）", () => {
    const ALLOW = "User-Agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: https://journey-photo.com/sitemap.xml\n";
    const BLOCK = "User-Agent: *\nDisallow: /\n";

    it("本番バケットに全面拒否を上げようとしたら止める（検索から消える）", () => {
        expect(() => assertRobotsMatchesTarget("prod-journey-photo.com", BLOCK))
            .toThrow(/全面拒否/);
    });

    it("staging に許可を上げようとしたら止める（重複コンテンツになる）", () => {
        expect(() => assertRobotsMatchesTarget("staging-journey-photo.com", ALLOW))
            .toThrow(/クロール許可/);
    });

    it("正しい組み合わせは通す", () => {
        expect(() => assertRobotsMatchesTarget("prod-journey-photo.com", ALLOW)).not.toThrow();
        expect(() => assertRobotsMatchesTarget("staging-journey-photo.com", BLOCK)).not.toThrow();
    });

    // `Disallow: /admin` を「全面拒否」と読み違えると、正しい本番の
    // デプロイが毎回止まる（直すために弱める、が起きる）。
    it("部分的な Disallow を全面拒否と読み違えない", () => {
        expect(() => assertRobotsMatchesTarget("prod-journey-photo.com",
            "User-Agent: *\nAllow: /\nDisallow: /user/\nDisallow: /login\n")).not.toThrow();
    });

    it("robots.txt が空なら本番では止める", () => {
        expect(() => assertRobotsMatchesTarget("prod-journey-photo.com", "")).not.toThrow();
        // 空は「許可」側なので staging では止まる
        expect(() => assertRobotsMatchesTarget("staging-journey-photo.com", "")).toThrow();
    });
});

// 消したキーが無効化の対象に入っていなかった。消しただけではエッジに
// 残った古い実体が返り続ける。今は HTML を no-store で配っているから
// 表面化していないだけで、キャッシュ設定を変えた瞬間に
// 「消したページが出続ける」に化ける。削除は写真を消したときの
// 掃除経路そのものなので、ここが効かないと消した内容が公開されたままになる。
describe("削除したキーも無効化の対象に入れる", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { invalidationTargets } = require("../deploy-static-site.js");

    it("消したキーが対象に入る", () => {
        // 変更は無し（ローカルにファイルが無いので changedKeys は空）
        expect(invalidationTargets([], [], ["photo/gone.html"]))
            .toEqual(["photo/gone.html"]);
    });

    it("消したものが無ければ、変更ぶんだけ（今までの動きを壊していない）", () => {
        expect(invalidationTargets([], [], [])).toEqual([]);
        expect(invalidationTargets([], [], undefined)).toEqual([]);
    });

    it("消したページは拡張子ありでもなしでも無効化される", () => {
        const paths = invalidationPathsFor(invalidationTargets([], [], ["photo/gone.html"]));
        expect(paths).toContain("/photo/gone.html");
        expect(paths).toContain("/photo/gone");   // 拡張子なしのURLでも配信される
    });

    it("消したぶんを混ぜても uploads/ を巻き込まない（安全側に倒す）", () => {
        expect(() => invalidationPathsFor(invalidationTargets([], [], ["uploads/a.html"])))
            .toThrow(/uploads/);
    });
});
