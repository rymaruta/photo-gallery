import { describe, it, expect } from "vitest";
import {
    slugify,
    collectEntries,
    photosInCollection,
    isIndexableCollection,
    labelForSlug,
    categoryDisplayName,
    collectionPath,
    canonicalCollectionPath,
    collectionCopy,
    CATEGORY_ALIASES,
    relatedEntries,
} from "../collections";
import type { Photo } from "../../data/photos";

const P = (over: Partial<Photo>): Photo => ({ id: Math.random().toString(36).slice(2), src: "https://cdn/x.jpg", ...over } as Photo);

const photos: Photo[] = [
    P({ id: "a", tags: ["白鳥", "湖"], location: "山中湖", category: "風景" }),
    P({ id: "b", tags: ["swan", "Lake"], location: "山中湖", category: "landscape" }),
    P({ id: "c", tags: ["白鳥"], location: "パリ", category: "街 スナップ" }),
    P({ id: "d", tags: ["苔"], location: "", category: "自然", published: false }), // 非公開は除外
];

// **スラッグはファイル名になる。** ここが長すぎる／制御文字を含むと、
// `next build` の静的書き出しが落ちて**サイト全体が出せなくなる**
// （新しい写真も、削除・非公開の反映も。site-rebuild も同じビルドを通る）。
// 実測: 撮影地に日本語83文字を入れて `npm run build` →
//   ENAMETOOLONG: mkdir '.next/server/app/location/東×83.segments'
//   Export encountered an error ... exiting the build
// 82文字なら通る（両側から挟んで確認）。撮影地の上限は 200 **文字**なので
// 日本語では届いてしまう。カテゴリ（100文字）も同じ。
describe("slugify がファイル名として安全であること", () => {
    // UTF-8 のバイト数（テスト側でも Buffer に頼らない）
    const bytes = (s: string) => {
        let n = 0;
        for (const ch of s) {
            const c = ch.codePointAt(0)!;
            n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
        }
        return n;
    };
    // `.segments` の9バイトを引いた実際の限界。ここを超えたらビルドが落ちる
    const HARD_LIMIT = 255 - ".segments".length;

    it.each([
        ["撮影地の上限いっぱいの日本語", "東".repeat(200)],
        ["カテゴリの上限いっぱいの日本語", "京".repeat(100)],
        ["絵文字だけ", "🗻".repeat(120)],
        ["ASCII の上限いっぱい", "a".repeat(200)],
    ])("%s でもファイル名の限界を超えない", (_name, value) => {
        expect(bytes(slugify(value)), "ENAMETOOLONG でビルドが落ちる").toBeLessThanOrEqual(HARD_LIMIT);
    });

    // **1文字ずらす。** 上限 200 は4の倍数なので、4バイト文字だけを並べると
    // バイト境界が必ず文字境界に一致する——**どんな切り方をしても孤立
    // サロゲートが出ない**（実測: コードユニットで数える壊れた実装に
    // 差し替えても全緑だった）。先頭に3バイト文字を1つ置いて境界をずらす。
    it("切っても文字の途中で割らない（孤立サロゲートを作らない）", () => {
        const out = slugify("あ" + "🗻".repeat(120));
        // 孤立サロゲート＝ペアになっていない D800-DFFF。`encodeURIComponent` が投げる
        const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
        expect(lone.test(out), "孤立サロゲートが残っている").toBe(false);
        expect(() => encodeURIComponent(out)).not.toThrow();
        expect(out.length, "空になっている（切りすぎ）").toBeGreaterThan(0);
    });

    it("切った尻尾に区切りを残さない", () => {
        // 200バイト目がちょうど区切りになる並び
        const value = "あ".repeat(66) + " " + "い".repeat(66);
        expect(slugify(value)).not.toMatch(/-$/);
    });

    // 切る前は「全部ドット」ではないので `^\.+$` の守りを通過し、
    // 切ったあとに全部ドットになる（`.` と `..` を捨てる守りの裏）
    it("切った結果が全部ドットになるなら捨てる", () => {
        expect(slugify(".".repeat(250) + "x")).toBe("");
    });

    it("上限に届かない値は1文字も変えない", () => {
        expect(slugify("山中湖")).toBe("山中湖");
        expect(slugify("東京 / 渋谷")).toBe("東京-渋谷");
    });

    // NUL は `mkdir` が `ERR_INVALID_ARG_VALUE` で投げる（実測でビルドが落ちた）
    it("制御文字を残さない", () => {
        expect(slugify("Kyoto\u0000X"), "NUL でビルドが落ちる").toBe("kyoto-x");
        expect(slugify("a\u0001b\u007Fc")).toBe("a-b-c");
        expect(slugify("\u0000")).toBe("");
    });
});

// **別名表を素の `[]` で引いていた。** `slugify("constructor", "category")` は
// 戻り値の型が `string` なのに **関数**（`Object`）を返し、`"__proto__"` は
// `Object.prototype` を返す。カテゴリは自由入力（サーバーの
// `sanitizeText(category, 100)` は `constructor` を素通しする）。
describe("カテゴリの別名表を、継承したプロパティで引かない", () => {
    it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
        "%s は別名ではなくその文字列として扱う", (name) => {
            const out = slugify(name, "category");
            expect(typeof out, "文字列以外が返っている").toBe("string");
            expect(out, "別名表ではなく Object のプロパティを引いている")
                .toBe(name.toLowerCase());   // slugify は小文字に寄せる
        });

    it("本物の別名は今までどおり当たる", () => {
        expect(slugify("建物", "category")).toBe("architecture");
    });
});

describe("slugify", () => {
    it("小文字化・trim・空白をハイフンに", () => {
        expect(slugify("  Lake District ")).toBe("lake-district");
    });
    it("日本語はそのまま（正規化のみ）", () => {
        expect(slugify("白鳥")).toBe("白鳥");
        expect(slugify("街 スナップ")).toBe("街-スナップ");
    });
});

describe("collectEntries", () => {
    it("タグを一意に集約し件数を数える（非公開は除外）", () => {
        const entries = collectEntries(photos, "tag");
        const map = Object.fromEntries(entries.map((e) => [e.slug, e.count]));
        expect(map["白鳥"]).toBe(2); // a, c
        expect(map["swan"]).toBe(1); // b
        expect(map["lake"]).toBe(1); // "Lake" → lake
        expect(map["苔"]).toBeUndefined(); // 非公開のみ
    });

    it("件数降順・slug昇順で安定ソート", () => {
        const entries = collectEntries(photos, "tag");
        expect(entries[0].slug).toBe("白鳥"); // 最多(2)
        expect(entries[0].label).toBe("白鳥");
    });

    it("location を集約（空文字は除外）", () => {
        const entries = collectEntries(photos, "location");
        const slugs = entries.map((e) => e.slug).sort();
        expect(slugs).toEqual(["パリ", "山中湖"]);
        expect(entries.find((e) => e.slug === "山中湖")?.count).toBe(2);
    });

    it("category を集約し、日本語表記は英語キーへまとめる", () => {
        const entries = collectEntries(photos, "category");
        const slugs = entries.map((e) => e.slug).sort();
        // 「風景」と「landscape」は同じ意味なので1ページにまとめる。
        // 別々のURLに分かれると、同じ内容で競合してどちらも弱くなる。
        expect(slugs).not.toContain("風景");
        expect(slugs).toContain("landscape");
        // 完全一致の別名だけを寄せる（「街-スナップ」は「街」ではないので残る）
        expect(slugs).toContain("街-スナップ");
    });

    it("まとめたカテゴリは両方の写真を拾う", () => {
        // 「風景」と「landscape」の写真が同じページに集まる
        const both = photosInCollection(photos, "category", "landscape").map((p) => p.id).sort();
        expect(both.length).toBeGreaterThanOrEqual(2);
    });
});

describe("photosInCollection", () => {
    it("slug に一致する公開写真を返す", () => {
        expect(photosInCollection(photos, "tag", "白鳥").map((p) => p.id).sort()).toEqual(["a", "c"]);
        expect(photosInCollection(photos, "location", "山中湖").map((p) => p.id).sort()).toEqual(["a", "b"]);
    });

    it("percent-encoded の slug でもデコードして一致する", () => {
        const enc = encodeURIComponent("白鳥");
        expect(photosInCollection(photos, "tag", enc).map((p) => p.id).sort()).toEqual(["a", "c"]);
    });

    it("大文字/空白違いを吸収する", () => {
        expect(photosInCollection(photos, "tag", "LAKE").map((p) => p.id)).toEqual(["b"]);
    });

    it("該当なしは空配列", () => {
        expect(photosInCollection(photos, "tag", "存在しない")).toEqual([]);
    });

    // **ホームと同じ順で返す。** 以前はここで並べ替えておらず、入力配列の順
    // （`photos.json` ＝ `createdAt` 降順）がそのまま出ていた。ホームは
    // `date || createdAt` で並べるので、**同じ絞り込みでも `/tag/風景` と
    // `/?tags=風景` で順が違う**（実データ30枚のうち28枚が別の位置に来る）。
    // どちらも「新しい順」を名乗るので、利用者には理由が見えない。
    describe("並び順", () => {
        // 入力は createdAt 降順（photos.json の作り）。撮影日はその逆順に置く
        const mixed: Photo[] = [
            P({ id: "posted-last", tags: ["風景"], date: "2020-01-01", createdAt: "2026-03-03T00:00:00.000Z" }),
            P({ id: "posted-mid", tags: ["風景"], createdAt: "2026-02-02T00:00:00.000Z" }),
            P({ id: "posted-first", tags: ["風景"], date: "2026-12-31", createdAt: "2026-01-01T00:00:00.000Z" }),
        ];

        it("撮影日の新しい順で返す（投稿順のままにしない）", () => {
            expect(photosInCollection(mixed, "tag", "風景").map((p) => p.id),
                "入力配列の順（投稿順）がそのまま出ている")
                .toEqual(["posted-first", "posted-mid", "posted-last"]);
        });

        it("撮影地の集約ページも同じ規則", () => {
            const withLoc = mixed.map((p) => ({ ...p, location: "山中湖" }));
            expect(photosInCollection(withLoc, "location", "山中湖").map((p) => p.id))
                .toEqual(["posted-first", "posted-mid", "posted-last"]);
        });

        // 呼び出し側が渡す配列の作り方が変わっても、出る順は変わらない
        it("入力配列の順に左右されない", () => {
            const shuffled = [mixed[1], mixed[2], mixed[0]];
            expect(photosInCollection(shuffled, "tag", "風景").map((p) => p.id))
                .toEqual(["posted-first", "posted-mid", "posted-last"]);
        });
    });
});

// カテゴリの見出しは別名表の逆引き（英語スラッグを日本語文に混ぜない）。
// 実ビルドで `/category/street` が「streetの写真（1枚）」、`/category/landscape` は
// 「風景の写真」——最初に一致した写真の生の値で決まっていた
describe("カテゴリの表示名", () => {
    const only = (category: string): Photo[] => [{ id: "s1", src: "https://cdn/s1.jpg", userId: "u", category, published: true } as Photo];

    it("英語スラッグしか持たない写真でも、見出しは日本語", () => {
        expect(labelForSlug(only("street"), "category", "street")).toBe("街");
        expect(labelForSlug(only("landscape"), "category", "landscape")).toBe("風景");
        // 別名が2つ寄るスラッグは表の先頭（建築／建物 → 建築）
        expect(labelForSlug(only("建物"), "category", "architecture")).toBe("建築");
    });

    it("写真の並び順で見出しが変わらない", () => {
        const a = { id: "a", src: "https://cdn/a.jpg", userId: "u", category: "street", published: true } as Photo;
        const b = { id: "b", src: "https://cdn/b.jpg", userId: "u", category: "街", published: true } as Photo;
        expect(labelForSlug([a, b], "category", "street")).toBe(labelForSlug([b, a], "category", "street"));
    });

    it("関連チップ（collectEntries）のラベルも同じ規則", () => {
        const entries = collectEntries(only("street"), "category");
        expect(entries.find((e) => e.slug === "street")?.label).toBe("街");
    });

    it("表に無いカテゴリは生の値のまま（ご飯・動物）", () => {
        expect(labelForSlug(only("ご飯"), "category", "ご飯")).toBe("ご飯");
        expect(collectEntries(only("動物"), "category")[0].label).toBe("動物");
    });

    it("タグ・撮影地には当てない", () => {
        expect(labelForSlug(photos, "tag", "lake")).toBe("Lake");
    });

    it("写真ページの表示名（labels.category.names）と食い違わない", async () => {
        // 同じ意味の表が2つある（別名表と i18n の表示名）。片方だけ直すと
        // 写真ページと集約ページで同じカテゴリが別の名前になる
        const { ja } = await import("@/app/i18n/labels");
        const names = ja.category?.names ?? {};
        let compared = 0;
        for (const [slug, name] of Object.entries(names)) {
            const mine = categoryDisplayName(slug);
            if (mine === undefined) continue;   // 別名表に無いスラッグ（all など）は対象外
            expect(mine, slug).toBe(name);
            compared++;
        }
        expect(compared).toBeGreaterThanOrEqual(4);
    });
});

describe("labelForSlug", () => {
    it("代表ラベル（生の値）を返す", () => {
        expect(labelForSlug(photos, "tag", "lake")).toBe("Lake");
        expect(labelForSlug(photos, "location", "パリ")).toBe("パリ");
    });
    it("一致が無ければデコードした slug", () => {
        expect(labelForSlug(photos, "tag", encodeURIComponent("未知"))).toBe("未知");
    });
});

describe("collectionPath", () => {
    it("日本語 slug を percent-encode したパスを返す", () => {
        expect(collectionPath("tag", "白鳥")).toBe(`/tag/${encodeURIComponent("白鳥")}`);
        expect(collectionPath("location", "パリ")).toBe(`/location/${encodeURIComponent("パリ")}`);
    });
});

describe("relatedEntries", () => {
    it("同タイプの他エントリを返す（自分自身は除外・件数順）", () => {
        const rel = relatedEntries(photos, "tag", "白鳥", 10);
        const slugs = rel.map((e) => e.slug);
        expect(slugs).not.toContain("白鳥");
        expect(slugs).toContain("swan");
        expect(slugs).toContain("lake");
    });

    it("percent-encoded slug でも自分自身を除外する", () => {
        const rel = relatedEntries(photos, "tag", encodeURIComponent("白鳥"), 10);
        expect(rel.map((e) => e.slug)).not.toContain("白鳥");
    });

    it("limit で件数を制限する", () => {
        expect(relatedEntries(photos, "tag", "白鳥", 2)).toHaveLength(2);
    });
});

describe("collectionCopy", () => {
    it("タイプ別に見出し・タイトル・説明を作る", () => {
        const t = collectionCopy("tag", "白鳥", 3);
        expect(t.heading).toBe("#白鳥 の写真");
        expect(t.title).toContain("白鳥の写真");
        expect(t.title).toContain("3枚");
        const l = collectionCopy("location", "山中湖", 2);
        expect(l.heading).toBe("山中湖の写真");
        expect(l.description).toContain("山中湖");
    });
});

// `<title>` にサイト名が2回入っていた。実際の出力:
//   「バルセロナの写真（1枚） | 旅フォトギャラリー | Journey Photo 旅フォトギャラリー」
// app/layout.tsx の `template` が付けるので、ここでは付けない。
// 検索結果で切られる位置に定型文が45〜60字並んでいた。
describe("collectionCopy: タイトルにサイト名を足さない", () => {
    it("サイト名は layout の template に任せる", () => {
        const { title } = collectionCopy("location", "バルセロナ", 1);
        expect(title).toBe("バルセロナの写真（1枚）");
        expect(title).not.toContain("旅フォトギャラリー");
        expect(title).not.toContain("Journey Photo");
    });

    it("枚数が無ければ枚数を出さない", () => {
        expect(collectionCopy("tag", "海", 0).title).toBe("海の写真");
    });
});

// カテゴリの別名表が2か所にあり、片方（i18n のラベルから作る表）に
// 「建物」が無かった。トップの絞り込みでは「建築」と「建物」が別のチップ
// として並ぶのに、/category/architecture は同じページにまとまる——
// 同じ写真の集合が、見る場所で違って見えていた。表は collections.ts を正とする。
describe("CATEGORY_ALIASES: 表記ゆれを1か所で吸収する", () => {
    it("「建物」も「建築」も同じキーに寄る", () => {
        expect(slugify("建物", "category")).toBe("architecture");
        expect(slugify("建築", "category")).toBe("architecture");
    });

    it("別名表は外から使える（useGallery が同じ表を見るため）", () => {
        expect(CATEGORY_ALIASES["建物"]).toBe("architecture");
        expect(CATEGORY_ALIASES["風景"]).toBe("landscape");
    });

    it("カテゴリ以外の種別には別名を当てない", () => {
        expect(slugify("建物", "tag")).toBe("建物");
        expect(slugify("建物", "location")).toBe("建物");
    });
});

// タグ・撮影地・カテゴリは自由入力で、そのまま `/tag/<値>` のパス片になる。
// 写真サイトでは `F/2.8`・`24/70mm`・`白/黒`・`東京 / 渋谷`・`#旅` はごく普通。
// サーバー側のサニタイズ（sanitizeText / sanitizeTags）は trim と長さしか
// 見ないので、これらはそのまま保存される。
describe("slugify: URL のパスに置けない文字", () => {
    // 静的書き出しはファイル名を `旅行%2F2024.html` とエンコードして保存するが、
    // 参照側は1回だけエンコードするので `/tag/…%2F2024` になる。S3 は
    // リクエストパスを1回デコードしてキーにするため `tag/旅行/2024.html` を
    // 探して**永久に当たらない**。サイトマップにも canonical にもその 404 が載る。
    it.each([
        ["旅行/2024", "旅行-2024"],
        ["s\\p18", "s-p18"],
        ["a?b", "a-b"],
        ["x#y", "x-y"],
        ["100%", "100"],
        ["東京 / 渋谷", "東京-渋谷"],
        ["F/2.8", "f-2.8"],
    ])("%s → %s", (input, expected) => {
        expect(slugify(input)).toBe(expected);
    });

    // `.` `..` はパス片としては「今のディレクトリ／親」。Next の静的書き出しが
    // `/location/..` を `/` に解決して「Requested and resolved page mismatch」で
    // **ビルドごと落ちる**。誰か1人が保存した瞬間から新しい写真も削除の反映も
    // 一切出せなくなる（site-rebuild も同じビルドを通る）。
    it.each(["..", ".", "...", " .. "])("%s は捨てる（ビルドを落とさせない）", (input) => {
        expect(slugify(input)).toBe("");
    });

    it("捨てた値は集約エントリにも出てこない", () => {
        const photos = [
            { id: "p1", src: "s", tags: ["..", "旅行/2024"] },
            { id: "p2", src: "s", tags: ["旅行/2024"] },
        ] as unknown as Parameters<typeof collectEntries>[0];
        const slugs = collectEntries(photos, "tag").map((e) => e.slug);
        expect(slugs).toEqual(["旅行-2024"]);
    });

    // 既存のURLを変えないこと（実データ73値でスラッグが変わらないのを確認済み）
    it("ふつうの値はこれまでどおり", () => {
        expect(slugify("パリ, フランス")).toBe("パリ,-フランス");
        expect(slugify("Mount Fuji")).toBe("mount-fuji");
        expect(slugify("  夜景  ")).toBe("夜景");
    });
});

// 生成側（photosInCollection / collectEntries）が完全一致、回遊リンク側
// （related.ts の sameLocation）が部分一致で食い違っていた。
// 症状: 写真ページの「「パリ」の他の写真」には3枚出るのに、そこから飛ぶ
// `/location/パリ` は自分1枚しか無い。しかも実データ14件の撮影地は
// **1つも MIN_INDEXABLE_COUNT(3) に届かず、14ページ全部が noindex・
// サイトマップ0件**だった（SEO のために作ったランディングが検索に出ていない）。
describe("撮影地の集約は related と同じ「緩い一致」で見る", () => {
    const photos = [
        { id: "p1", src: "s", location: "パリ" },
        { id: "p2", src: "s", location: "パリ, フランス" },
        { id: "p3", src: "s", location: "オペラ・ガルニエ（パリ）" },
        { id: "p4", src: "s", location: "東京" },
        { id: "p5", src: "s", location: "京都", published: false },   // 非公開は数えない
    ] as unknown as Parameters<typeof collectEntries>[0];

    it("入れ子の地名をまとめて拾う", () => {
        const ids = photosInCollection(photos, "location", "パリ").map((p) => p.id);
        expect(ids).toEqual(["p1", "p2", "p3"]);
    });

    it("件数も同じ数え方（見出しと実際の枚数がずれない）", () => {
        const entries = collectEntries(photos, "location");
        const paris = entries.find((e) => e.slug === "パリ");
        expect(paris?.count).toBe(3);
        // これで初めて検索エンジンに載せてよい枚数になる
        expect(isIndexableCollection(paris!.count)).toBe(true);
    });

    it("関係ない地名は混ざらない", () => {
        expect(photosInCollection(photos, "location", "東京").map((p) => p.id)).toEqual(["p4"]);
    });

    it("非公開は数にも一覧にも入らない", () => {
        expect(photosInCollection(photos, "location", "京都")).toEqual([]);
    });

    // タグとカテゴリは離散的なラベルなので完全一致のまま
    it("タグは部分一致にしない（「旅」で「旅行」を拾わない）", () => {
        const tagged = [
            { id: "t1", src: "s", tags: ["旅"] },
            { id: "t2", src: "s", tags: ["旅行"] },
        ] as unknown as Parameters<typeof collectEntries>[0];
        expect(photosInCollection(tagged, "tag", "旅").map((p) => p.id)).toEqual(["t1"]);
    });
});

// canonical と JSON-LD（ImageGallery の url・パンくず）が別々にURLを組んで
// いて、旧カテゴリで食い違っていた: /category/風景 は canonical が
// /category/landscape を指すのに、構造化データは /category/風景 を名乗る。
// 「評価を統合後にまとめる」という目的に対して逆を言っていた。
describe("canonicalCollectionPath: 旧カテゴリは統合後を指す", () => {
    it("旧スラッグでも統合後のパスを返す", () => {
        expect(canonicalCollectionPath("category", "風景")).toBe(
            canonicalCollectionPath("category", "landscape"));
        expect(canonicalCollectionPath("category", "風景")).toContain("/category/landscape");
    });

    it("タグ・撮影地はそのまま（統合の対象ではない）", () => {
        expect(canonicalCollectionPath("tag", "夜景")).toBe(collectionPath("tag", "夜景"));
        expect(canonicalCollectionPath("location", "パリ")).toBe(collectionPath("location", "パリ"));
    });
});
