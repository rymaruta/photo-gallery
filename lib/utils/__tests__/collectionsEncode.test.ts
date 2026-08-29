import { describe, it, expect } from "vitest";
import { collectionPath, slugify } from "../collections";

// `encodeURIComponent` は孤立サロゲートで `URIError` を投げる。
// 切り詰めが絵文字を割った値が1つでも保存されていると、そのタグの
// `generateMetadata` が落ちて**静的ビルドが丸ごと止まる**
// （`slugify` が `..` について書いている事故と同じ型）。
// 入口（sanitize の truncate）は塞いだが、**既に保存されている値には
// 効かない**ので、ここでも受ける。

const broken = "旅".repeat(49) + "😊";   // これを 50 で切ると半分になる

describe("collectionPath: 壊れた値でもビルドを落とさない", () => {
    it("孤立サロゲートが混ざっていても投げない", () => {
        expect(() => collectionPath("tag", broken.slice(0, 50))).not.toThrow();
    });

    it("壊れた半分は落として、残りはURLに載せる", () => {
        const path = collectionPath("tag", broken.slice(0, 50));
        expect(path.startsWith("/tag/")).toBe(true);
        // 復号すると壊れた文字が残っていない
        const decoded = decodeURIComponent(path.slice("/tag/".length));
        expect(decoded).toBe("旅".repeat(49));
    });

    it("正常な絵文字はそのまま載る（拾いすぎない）", () => {
        const path = collectionPath("tag", "旅😊");
        expect(decodeURIComponent(path.slice("/tag/".length))).toBe("旅😊");
    });

    it("普通の日本語はこれまでどおり", () => {
        expect(collectionPath("location", "東京")).toBe(`/location/${encodeURIComponent("東京")}`);
    });
});

// **掃除は `slugify` に置く。** `collectionPath` だけで掃除していた頃は、
// ルート（generateStaticParams は slugify の値をそのまま使う）と
// リンク・canonical・サイトマップの値が**食い違って**いた——
// どこからもリンクの無いページと、0件を指す 404 ができる。
// しかもルートの値には孤立サロゲートが残るので、encodeURIComponent は
// 依然として投げる（＝ビルドが止まる筋が閉じていない）。
describe("slugify: URL に載せられない値を作らない", () => {
    const broken = ("旅".repeat(49) + "😊").slice(0, 50);

    it("孤立サロゲートを落とす", () => {
        const slug = slugify(broken, "tag");
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(slug)).toBe(false);
        expect(() => encodeURIComponent(slug)).not.toThrow();
    });

    // ここが要点。ルートとリンクが同じ値でなければ 404 になる
    it("ルートの slug と、リンクの slug が一致する", () => {
        const slug = slugify(broken, "tag");
        expect(collectionPath("tag", slug)).toBe(`/tag/${encodeURIComponent(slug)}`);
    });

    it("正当な絵文字は落とさない", () => {
        expect(slugify("旅😊", "tag")).toContain("😊");
        expect(slugify("😊😊", "tag")).toBe("😊😊");
    });

    it("これまでの正規化は変わらない", () => {
        expect(slugify("東京 / 渋谷", "location")).toBe("東京-渋谷");
        expect(slugify("#旅", "tag")).toBe("-旅".replace(/^-/, "") || "旅");
    });
});
