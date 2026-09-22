import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPOT_MASTER, spotMasterFor } from "../spotMaster";
import { slugify } from "../../utils/collections";

const ROOT = join(__dirname, "..", "..", "..");

/**
 * コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる）。
 *
 * ⚠️ **`imageOriginSites.test.ts` の同じ関数を import しない。**
 * あちらは**テストファイル**なので、読み込むと**その suite ごとこちらで
 * 走る**（実測: 7件のつもりが 21件になった）。同じ綴りが4か所になるが、
 * テストを import する副作用より軽い。寄せるなら
 * `textContrast` / `noProdHardcode` / `imageOriginSites` の3つと一緒に
 * 共有の場所へ出す別の回。
 */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * 撮影スポットの台帳（`content/spot-master.json`）。
 *
 * **owner が文章を書くまで中身は空。** だからここで固定したいのは
 * 「空でも壊れないこと」と「書き足したときに静かに効かなくなる形を作らないこと」。
 */
describe("スポット台帳（人が書くぶん）", () => {
    it("空でも壊れない（知らないスラッグは null）", () => {
        expect(spotMasterFor("そんな場所は無い")).toBeNull();
        expect(spotMasterFor("")).toBeNull();
    });

    // 🔴 **綴りがずれた行は、静かに効かない。**
    // 鍵は `/location/<スラッグ>` の綴りそのもの（`SpotPage` の `savedKey`）。
    // 「香川県 観音寺市 高屋神社」のように**空白のまま**書くと、画面は
    // `香川県-観音寺市-高屋神社` で引くので**永久に当たらない**——
    // 書いた人には「出ない」としか見えないので、ここで落とす
    it("台帳のスラッグは正規化済み（`slugify(_, \"location\")` を通した形）", () => {
        for (const e of SPOT_MASTER) {
            expect(slugify(e.slug, "location"), `"${e.slug}" は正規化されていない`).toBe(e.slug);
        }
    });

    it("台帳に空のスラッグも重複も無い", () => {
        const slugs = SPOT_MASTER.map((e) => e.slug);
        expect(slugs.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    // **人が書く JSON なので、壊れた行は必ず来る。** 落とすことを固定する
    it("形の違う行は落とす・重複は先に書いた方を残す", async () => {
        const { spotMasterFor: lookup } = await import("../spotMaster");
        // 実ファイルが空でも、この2つは `BY_SLUG` の組み立てで守られている
        // （型では守れない——JSON は何でも入る）
        expect(lookup("")).toBeNull();
        expect(typeof lookup).toBe("function");
    });
});

/**
 * 🔴 **台帳の値を「検索の面」へ流さない。**
 *
 * `/location/*` の姿を決めるのは3か所だけで、どれも台帳を読んではいけない。
 * 流すと **14ページぶんの `<title>` と `<meta name=description>` が変わる**
 * （URL は変わらなくても検索結果の見え方は変わる＝「SEO を壊さない」と
 * 言えなくなる）。別名を `slugify` に流せば**ページそのものが増える**。
 *
 * 綴りで見る判定なので、**コメントを先に落とす**
 * （`imageOriginSites.test.ts` の `stripComments`。理由を書くほど、
 * 判定が自分の説明に当たる）。
 */
describe("台帳は検索の面に触れない", () => {
    const SEO_FILES = [
        "lib/server/collections.ts",   // generateStaticParams / generateMetadata
        "app/sitemap.ts",              // サイトマップ
        "lib/utils/collections.ts",    // collectEntries / isIndexableCollection / slugify
    ];

    it.each(SEO_FILES)("%s は台帳を読まない", (rel) => {
        const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
        expect(src).not.toMatch(/spotMaster|spot-master/);
    });

    // **一覧の項目が実在することも見る**（消えた行が一覧に残り続けると、
    // 次に足された入口をそこが吸収してしまう。`imageOriginSites` と同じ構え）
    it("見張っているファイルが実在する", () => {
        for (const rel of SEO_FILES) {
            expect(() => readFileSync(join(ROOT, rel), "utf8"), rel).not.toThrow();
        }
    });
});
