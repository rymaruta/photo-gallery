import { describe, it, expect } from "vitest";
import { buildFeed, feedExcerpt, FEED_MAX_ITEMS } from "../feed.xml/route";
import type { Photo } from "@/lib/data/photos";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// RSS フィード（`/feed.xml`）。
//
// **このサイトには「また来る」ための入口が1つも無かった。** 検索から1枚見て
// 帰る人しかいない状態で、購読の手段が無い。フィードは (a) 戻ってくる導線、
// (b) 収集サービス経由の露出、(c) クローラが更新を知る手がかり を兼ねる。
//
// ここで固定するのは:
//   - **1文字でフィード全体が壊れない**こと（制御文字・記号）
//     ——サイトマップが制御文字1つで丸ごと parse error になった前例がある
//   - 下書きを出さないこと／新しい順／件数の上限

const photo = (over: Partial<Photo> = {}): Photo => ({
    id: "p1", src: "https://cdn/1.jpg", published: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "湖", description: "静かな朝でした。",
    ...over,
} as unknown as Photo);

/** XML として読めるか */
const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const failed = (doc: Document) => doc.querySelector("parsererror") !== null;

describe("フィードの形", () => {
    it("XML として読める", () => {
        expect(failed(parse(buildFeed([photo()])))).toBe(false);
    });

    it("写真ごとに項目が出る", () => {
        expect(parse(buildFeed([photo({ id: "a" }), photo({ id: "b" })])).querySelectorAll("item").length).toBe(2);
    });

    it("自分の場所を名乗る（収集側が正規のフィードURLを知る）", () => {
        expect(buildFeed([photo()])).toContain('rel="self"');
    });

    it("項目のリンクは写真ページ", () => {
        expect(buildFeed([photo({ id: "abc" })])).toContain("/photo/abc");
    });

    it("写真が1枚も無くても壊れない", () => {
        expect(failed(parse(buildFeed([])))).toBe(false);
    });
});

describe("壊れた入力でフィード全体を落とさない", () => {
    // **サイトマップが制御文字1つで丸ごと parse error になった前例がある。**
    // 文字はエスケープで組み立てる（ソースに直接書かない）
    it.each([
        ["NUL", 0x00],
        ["縦タブ", 0x0b],
        ["XML 1.0 に無い文字", 0xfffe],
    ])("XML 1.0 に無い文字（%s）が混ざっても読める", (_n, code) => {
        const title = `湖${String.fromCharCode(code as number)}です`;
        expect(failed(parse(buildFeed([photo({ title } as Partial<Photo>)]))), "フィード全体が壊れた").toBe(false);
    });

    it.each([
        ["アンパサンド", "R&D の湖"],
        ["山かっこ", "<script>alert(1)</script>"],
        ["引用符", 'とても"静か"な湖'],
    ])("%s を含む題でも読める", (_n, title) => {
        expect(failed(parse(buildFeed([photo({ title } as Partial<Photo>)]))), "フィード全体が壊れた").toBe(false);
    });

    // **合法な文字は消さない。** `U+007F`（DEL）と C1（U+0085 等）は
    // XML 1.0 では合法で、`app/sitemap-images.xml` も落としていない
    // （隣で違う範囲を書くと、片方だけが黙って文字を消す）
    it.each([
        ["DEL", 0x7f],
        ["C1（NEL）", 0x85],
    ])("XML 1.0 で合法な文字（%s）は消さない", (_n, code) => {
        const ch = String.fromCharCode(code as number);
        const xml = buildFeed([photo({ title: `湖${ch}です` } as Partial<Photo>)]);
        expect(failed(parse(xml))).toBe(false);
        expect(xml, "合法な文字を消している").toContain(ch);
    });

    it("タグとして解釈させない", () => {
        const xml = buildFeed([photo({ title: "<b>湖</b>" } as Partial<Photo>)]);
        expect(xml).not.toContain("<b>湖</b>");
        expect(xml).toContain("&lt;b&gt;");
    });
});

describe("何を出すか", () => {
    it("下書きは出さない", () => {
        expect(parse(buildFeed([photo({ id: "pub" }), photo({ id: "draft", published: false })]))
            .querySelectorAll("item").length).toBe(1);
        expect(buildFeed([photo({ id: "draft", published: false })])).not.toContain("/photo/draft");
    });

    it("新しい順に並ぶ", () => {
        const xml = buildFeed([
            photo({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
            photo({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" }),
        ]);
        expect(xml.indexOf("/photo/new")).toBeLessThan(xml.indexOf("/photo/old"));
    });

    // **並べる基準は「投稿の新しさ」。撮影日ではない。**
    // 撮影日で並べていた頃は、`pubDate`（投稿日）と食い違い、しかも
    // 公開数が上限ちょうどのとき**「撮影日が古い新着」がフィードに
    // 一度も載らない**——「新しいものを伝える」目的を外していた
    it("撮影日が古くても、投稿が新しければ先に出る", () => {
        const xml = buildFeed([
            photo({ id: "recent-shot", date: "2026-06-01", createdAt: "2026-01-01T00:00:00.000Z" }),
            photo({ id: "old-shot", date: "1999-01-01", createdAt: "2026-06-01T00:00:00.000Z" }),
        ]);
        expect(xml.indexOf("/photo/old-shot"), "撮影日で並べている").toBeLessThan(xml.indexOf("/photo/recent-shot"));
    });

    it("上限に当たっても、新しい投稿は必ず載る", () => {
        const filler = Array.from({ length: FEED_MAX_ITEMS }, (_, i) =>
            photo({ id: `f${i}`, date: "2026-12-31", createdAt: "2026-01-01T00:00:00.000Z" }));
        const xml = buildFeed([...filler, photo({ id: "newest", date: "1999-01-01", createdAt: "2026-09-09T00:00:00.000Z" })]);
        expect(xml, "新着がフィードに載らない").toContain("/photo/newest");
    });

    // **フィードは「新しいもの」を伝えるもの。** 全件出すと重くなる
    it("件数に上限がある", () => {
        const many = Array.from({ length: FEED_MAX_ITEMS + 10 }, (_, i) =>
            photo({ id: `p${i}`, createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z` }));
        expect(parse(buildFeed(many)).querySelectorAll("item").length).toBe(FEED_MAX_ITEMS);
    });
});

describe("抜粋", () => {
    // **全文を載せない。** フィードだけで完結すると、来てもらう目的から外れる
    it("長い説明は切る", () => {
        expect(feedExcerpt(photo({ description: "あ".repeat(300) } as Partial<Photo>)).length).toBeLessThanOrEqual(141);
    });

    it("説明が無ければ撮影地で組み立てる", () => {
        expect(feedExcerpt(photo({ description: undefined, location: "パリ" } as Partial<Photo>))).toContain("パリ");
    });

    it("説明も撮影地も無くても空にしない", () => {
        expect(feedExcerpt(photo({ description: undefined, location: undefined } as Partial<Photo>))).not.toBe("");
    });
});

// **置いただけでは誰も見つけない。** ブラウザの拡張・収集サービスは
// `<link rel="alternate" type="application/rss+xml">` を見て購読先を出す。
// `robots.txt` に書いても購読の導線にはならない。
describe("フィードの場所を名乗っているか", () => {
    // レイアウトは `next/font` を読むので vitest から import できない
    // （`Inter is not a function`）。ソースで見る——このリポジトリの
    // 他の配線テスト（`sitemapCamera` / `collectionRoutes`）と同じ手。
    // **`alternates` はオブジェクトごと差し替わる。** ルートに書いても、
    // 子が `alternates: { canonical }` を返した瞬間に消える
    // ——実際そうなっていて、実ビルドの141枚中フィードを名乗っていたのは
    // 404 の2枚だけだった（`INDEXABLE_ROBOTS` が同じ理由で同じ形にしてある）。
    // **`alternates` を書くページは、必ず `FEED_ALTERNATE` を混ぜること。**
    it.each(["layout.tsx", "page.tsx"])("%s が alternates を書くなら FEED_ALTERNATE を混ぜる", (file) => {
        const src = readFileSync(join(__dirname, "..", file), "utf8").replace(/^\s*\/\/.*$/gm, " ");
        const at = src.indexOf("alternates:");
        if (at === -1) return;   // 書いていないなら関係ない
        // **`alternates` の中だけを見る。** ファイル全体を `toContain` で
        // 見ていたら、**import 行の `FEED_ALTERNATE` に当たって**
        // 宣言を消す変異が素通りした（守っているつもりで何も見ていない）
        const block = src.slice(at, src.indexOf("},", at) + 2);
        expect(block, `${file} の alternates がフィードの宣言を消している`).toContain("FEED_ALTERNATE");
    });

    it("FEED_ALTERNATE が feed.xml を指している", async () => {
        const { FEED_ALTERNATE } = await import("../../lib/utils/seo");
        const rss = (FEED_ALTERNATE.types as Record<string, { url: string }[]>)["application/rss+xml"];
        expect(String(rss[0].url)).toContain("/feed.xml");
    });
});
