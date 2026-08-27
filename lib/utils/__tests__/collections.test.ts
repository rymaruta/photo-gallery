import { describe, it, expect } from "vitest";
import {
    slugify,
    collectEntries,
    photosInCollection,
    labelForSlug,
    collectionPath,
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
