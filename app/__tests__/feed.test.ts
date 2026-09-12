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

/**
 * **誰が撮ったかを名乗る（owner の指示「人名で1位に」）。**
 *
 * RSS 2.0 の `<author>` は**メールアドレスが必須**（仕様が
 * `<author>user@example.com (Name)`）なので使えない。名前だけを出す標準は
 * Dublin Core の `dc:creator`。写真ページの `author`（JSON-LD と
 * `<meta name="author">`）と同じ目的——「この30件は同じ人のもの」を
 * 機械に言う。
 */
describe("フィードに撮影者を出す", () => {
    const withName = (n: number, name?: string): Photo[] =>
        Array.from({ length: n }, (_, i) => ({
            id: `p${i}`, src: `https://cdn/${i}.jpg`, title: `題${i}`,
            createdAt: "2026-01-01T00:00:00Z", ...(name ? { displayName: name } : {}),
        } as unknown as Photo));

    it("dc:creator に表示名を出す", () => {
        const doc = parse(buildFeed(withName(2, "丸田 竜平")));
        expect(doc.querySelector("parsererror"), "XML として読めない").toBeNull();
        const creators = Array.from(doc.getElementsByTagName("dc:creator")).map((e) => e.textContent);
        expect(creators, "撮影者を出していない").toEqual(["丸田 竜平", "丸田 竜平"]);
    });

    // **名前空間の宣言を落とすと、フィード全体が parse error になる**
    // （`sitemap-images.xml` で一度踏んだ形）
    it("dc の名前空間を宣言している", () => {
        const xml = buildFeed(withName(1, "丸田 竜平"));
        expect(xml, "宣言が無い（収集側が読めない）").toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
        expect(parse(xml).querySelector("parsererror")).toBeNull();
    });

    // **無いときは行ごと出さない**（空のタグを並べない）
    it("表示名が無ければ、その行は出さない", () => {
        const xml = buildFeed(withName(2));
        expect(xml).not.toContain("dc:creator");
        expect(parse(xml).querySelector("parsererror")).toBeNull();
    });

    // **名前にも記号が入りうる**（`&` `<` は必ずエスケープする）
    it("記号を含む名前でも壊れない", () => {
        const xml = buildFeed(withName(1, "A & B <x>"));
        const doc = parse(xml);
        expect(doc.querySelector("parsererror"), "エスケープしていない").toBeNull();
        expect(doc.getElementsByTagName("dc:creator")[0]?.textContent).toBe("A & B <x>");
    });

    it("人によって違う名前を出す（1つに丸めない）", () => {
        const photos = [
            ...withName(1, "丸田 竜平"),
            { id: "x", src: "https://cdn/x.jpg", title: "他", createdAt: "2026-01-02T00:00:00Z", displayName: "別の人" } as unknown as Photo,
        ];
        const creators = Array.from(parse(buildFeed(photos)).getElementsByTagName("dc:creator")).map((e) => e.textContent);
        expect(new Set(creators).size, "全部同じ名前になっている").toBe(2);
    });
});

// **140字で切る前に畳む。** 畳まないと改行のぶんまで数えて本文が短くなる
describe("抜粋は1行", () => {
    it("説明の改行を空白にする", () => {
        const e = feedExcerpt(photo({ description: { ja: ["一行目。\n二行目。"] } } as Partial<Photo>));
        expect(e, "生の改行が残っている").not.toContain("\n");
        expect(e).toBe("一行目。 二行目。");
    });

    // **畳んでから切る。** 効くのは「空白の連なり」——単独の改行は空白1つに
    // なるだけで字数は変わらない。空行を挟む書き方だけが縮む
    it("空白の連なりを畳んでから140字で切る", () => {
        const text = "あ".repeat(138) + "\n\n\n\n\n" + "い"; // 生 144字 / 畳むと 140字
        const e = feedExcerpt(photo({ description: { ja: [text] } } as Partial<Photo>));
        expect(e.endsWith("…"), "畳む前に切っている").toBe(false);
        expect(e.length).toBe(140);
    });
});
