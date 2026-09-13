import { describe, it, expect, vi, afterEach } from "vitest";
import { buildImageSitemap, titleOf, captionOf, CAPTION_MAX } from "../sitemap-images.xml/route";
import type { Photo } from "@/lib/data/photos";

/**
 * 画像サイトマップ（`/sitemap-images.xml`）。
 *
 * **「テストが1本も無かった」は誤りだった**（レビューが指摘・確認した）。
 * `app/__tests__/robots.test.ts:90` が前からこのルートを import していて、
 * 制御文字・タブ改行の保持・記号のエスケープを見ている。ここはそこに
 * 無かった契約（**言語**・**切り詰め**・**組み立て**）を足す。
 *
 * ここで固定するのは:
 *   - **題と説明がこのサイトの言語（日本語）で1本**であること
 *     ——以前は `ja + " / " + en` と併記していて、実ビルドの **54か所**が
 *     「白鳥と湖 / Swans on the Lake」の形だった。同じページの
 *     `<meta name="description">` は日本語だけを出しているので、
 *     **機械向けの経路にだけ英語が残っていた**
 *   - 撮影地が切り詰めで真っ先に消えないこと
 *   - 1文字で XML 全体が壊れないこと（`feed.xml` と同じ型）
 */
const photo = (over: Partial<Photo> = {}): Photo => ({
    id: "p1", src: "https://cdn/1.jpg", published: true,
    title: { ja: "白鳥と湖", en: "Swans on the Lake" },
    description: { ja: ["餌を探していた。"], en: ["They were searching for food."] },
    ...over,
} as unknown as Photo);

const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const failed = (doc: Document) => doc.querySelector("parsererror") !== null;

describe("画像サイトマップの言語", () => {
    it("題は日本語だけ（英語を併記しない）", () => {
        expect(titleOf(photo())).toBe("白鳥と湖");
    });

    it("説明も日本語だけ", () => {
        expect(captionOf(photo())).toBe("餌を探していた。");
    });

    it("日本語が無ければ英語に落ちる（出せるものが無いよりはよい）", () => {
        expect(titleOf(photo({ title: { en: "Swans" } } as Partial<Photo>))).toBe("Swans");
        expect(captionOf(photo({ description: { en: ["Only English."] } } as Partial<Photo>)))
            .toBe("Only English.");
    });

    it("XML にも英語が出ない", () => {
        const xml = buildImageSitemap([photo()]);
        expect(xml).toContain("<image:title>白鳥と湖</image:title>");
        expect(xml, "英語が併記されている").not.toContain("Swans on the Lake");
        expect(xml).not.toContain(" / ");
    });
});

describe("画像サイトマップの説明の切り詰め", () => {
    it("撮影地は切り詰めで消えない（説明より先に席を取る）", () => {
        const long = "あ".repeat(CAPTION_MAX * 2);
        const c = captionOf(photo({ description: { ja: [long] }, location: "パリ, フランス" } as Partial<Photo>));
        expect(c.endsWith("（パリ, フランス）"), "撮影地が落ちている").toBe(true);
        expect(c.length).toBeLessThanOrEqual(CAPTION_MAX);
    });

    it("撮影地が無ければ説明が上限いっぱい入る", () => {
        const long = "あ".repeat(CAPTION_MAX * 2);
        expect(captionOf(photo({ description: { ja: [long] } } as Partial<Photo>)).length).toBe(CAPTION_MAX);
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe("画像サイトマップの形", () => {
    it("XML として読める", () => {
        expect(failed(parse(buildImageSitemap([photo()])))).toBe(false);
    });

    // サイトマップは制御文字1つで**丸ごと** parse error になる（その1件だけ
    // でなく全件の `<image:loc>` が読めなくなる）。台帳が一度踏んだ型。
    // **説明側にも入れる**——題にだけ入れると `esc(caption)` を外す変異が
    // このファイルでは生き残る（`robots.test.ts` では死ぬ）
    it("制御文字が1つ混ざっても壊れない（題にも説明にも）", () => {
        const bad = `壊${String.fromCharCode(11)}す`;
        const doc = parse(buildImageSitemap([
            photo({ title: { ja: bad }, description: { ja: [bad] } } as Partial<Photo>),
            photo({ id: "p2" }),
        ]));
        expect(failed(doc), "1件の制御文字で XML 全体が読めなくなっている").toBe(false);
        expect(doc.querySelectorAll("url").length).toBe(2);
    });

    // **画像のURLはサイトのドメインに揃える**（`publicImageUrl`）。
    // 同じ配信の別名で2つに割れていた（実測 30件中11件が CloudFront の
    // 既定ドメイン）。このファイルが一番重視している処理なのに、
    // 変異で外しても誰も落ちなかった（レビュー指摘）。
    //
    // **揃える先は環境変数から決まる**（`NEXT_PUBLIC_CLOUDFRONT_URL` を
    // モジュール読み込み時に1回読む）ので、`publicImageUrl.test.ts` と
    // 同じく読み直してから確かめる
    it("画像のURLはサイトのドメインに揃える", async () => {
        vi.resetModules();
        vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", "https://d1s3dwwzgxf5ni.cloudfront.net");
        vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journey-photo.com");
        const build = (await import("../sitemap-images.xml/route")).buildImageSitemap;
        const xml = build([photo({ src: "https://d1s3dwwzgxf5ni.cloudfront.net/uploads/a.jpg" })]);
        expect(xml).toContain("<image:loc>");
        expect(xml, "CloudFront の既定ドメインのまま出ている").not.toContain("cloudfront.net");
        expect(xml).toContain("journey-photo.com/uploads/a.jpg");
    });

    it("写真が0枚でも壊れない", () => {
        const xml = buildImageSitemap([]);
        expect(failed(parse(xml))).toBe(false);
        expect(parse(xml).querySelectorAll("url").length).toBe(0);
    });

    it("写真ごとに1件・リンクは写真ページ", () => {
        const xml = buildImageSitemap([photo({ id: "abc" }), photo({ id: "def" })]);
        expect(parse(xml).querySelectorAll("url").length).toBe(2);
        expect(xml).toContain("/photo/abc");
    });

    // **空行も出さない。** `not.toContain("<image:title>")` だけだと
    // `filter(Boolean)` を外す変異が生き残る（空行が増えるだけで XML は
    // 妥当なまま）——レビューが実証した穴
    it("題も説明も無い写真では、空の要素も空行も出さない", () => {
        const xml = buildImageSitemap([photo({ title: undefined, description: undefined } as Partial<Photo>)]);
        expect(xml).not.toContain("<image:title>");
        expect(xml).not.toContain("<image:caption>");
        expect(xml.split("\n").filter((l) => l.trim() === ""), "空行が出ている").toEqual([]);
    });

    it("撮影地が上限より長くても、説明は上限を超えない", () => {
        const c = captionOf(photo({
            description: { ja: ["あ".repeat(CAPTION_MAX * 2)] },
            location: "パ".repeat(CAPTION_MAX + 100),
        } as Partial<Photo>));
        expect(c.length, "上限を超えている").toBeLessThanOrEqual(CAPTION_MAX);
    });
});

// **caption は1行の説明文として読まれる。** XML としては改行も通るが、
// 実ビルドで4件が生の改行を含んでいた
describe("画像サイトマップの caption は1行", () => {
    it("説明の改行を空白にする", () => {
        const c = captionOf(photo({ description: { ja: ["一行目。\n二行目。"] } } as Partial<Photo>));
        expect(c, "生の改行が残っている").not.toContain("\n");
        expect(c).toBe("一行目。 二行目。");
    });
});
