import { describe, it, expect } from "vitest";
import {
    slugify,
    collectEntries,
    photosInCollection,
    labelForSlug,
    collectionPath,
    collectionCopy,
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
