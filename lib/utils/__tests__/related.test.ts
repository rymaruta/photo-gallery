import { describe, it, expect } from "vitest";
import type { Photo } from "../../data/photos";
import { sameLocation, sameAuthorPhotos, sameLocationPhotos, adjacentPhotos } from "../related";

function p(over: Partial<Photo> & { id: string }): Photo {
    return { src: `https://cdn/${over.id}.jpg`, ...over } as Photo;
}

describe("sameLocation", () => {
    it("完全一致", () => {
        expect(sameLocation("北海道", "北海道")).toBe(true);
    });
    it("大文字小文字・空白を無視", () => {
        expect(sameLocation(" Hokkaido ", "hokkaido")).toBe(true);
    });
    it("一方が他方を含む（市区町村 vs 都道府県）", () => {
        expect(sameLocation("北海道 札幌市", "北海道")).toBe(true);
    });
    it("無関係な場所は false", () => {
        expect(sameLocation("北海道", "沖縄")).toBe(false);
    });
    it("1文字以下・空は false", () => {
        expect(sameLocation("東", "東京")).toBe(false);
        expect(sameLocation("", "北海道")).toBe(false);
        expect(sameLocation(undefined, "北海道")).toBe(false);
    });
});

describe("sameAuthorPhotos", () => {
    const cur = p({ id: "c", userId: "u1", createdAt: "2026-03-01" });
    const all = [
        cur,
        p({ id: "a", userId: "u1", createdAt: "2026-01-01" }),
        p({ id: "b", userId: "u1", createdAt: "2026-02-01" }),
        p({ id: "other", userId: "u2", createdAt: "2026-02-15" }),
        p({ id: "hidden", userId: "u1", createdAt: "2026-02-20", published: false }),
    ];

    it("同じ投稿者の写真だけを新しい順で返す（自身・非公開・他人を除外）", () => {
        const res = sameAuthorPhotos(cur, all);
        expect(res.map((x) => x.id)).toEqual(["b", "a"]);
    });

    it("userId が無ければ空", () => {
        expect(sameAuthorPhotos(p({ id: "x" }), all)).toEqual([]);
    });

    it("limit で件数を制限する", () => {
        expect(sameAuthorPhotos(cur, all, 1).map((x) => x.id)).toEqual(["b"]);
    });
});

describe("sameLocationPhotos", () => {
    const cur = p({ id: "c", userId: "u1", location: "北海道", createdAt: "2026-03-01" });
    const all = [
        cur,
        p({ id: "same-loc", userId: "u2", location: "北海道 函館", createdAt: "2026-02-01" }),
        p({ id: "same-author-same-loc", userId: "u1", location: "北海道", createdAt: "2026-02-10" }),
        p({ id: "other-loc", userId: "u3", location: "沖縄", createdAt: "2026-02-20" }),
    ];

    it("同じ場所の写真を返すが、同一投稿者は除外（投稿者列と重複させない）", () => {
        const res = sameLocationPhotos(cur, all);
        expect(res.map((x) => x.id)).toEqual(["same-loc"]);
    });

    it("location が無ければ空", () => {
        expect(sameLocationPhotos(p({ id: "x", userId: "u1" }), all)).toEqual([]);
    });
});

describe("adjacentPhotos", () => {
    const all = [
        p({ id: "new", createdAt: "2026-03-01" }),
        p({ id: "mid", createdAt: "2026-02-01" }),
        p({ id: "old", createdAt: "2026-01-01" }),
    ];

    it("新しい順で前後を返す（prev=より新しい, next=より古い）", () => {
        const res = adjacentPhotos(p({ id: "mid", createdAt: "2026-02-01" }), all);
        expect(res.prev?.id).toBe("new");
        expect(res.next?.id).toBe("old");
    });

    it("先頭は prev=null", () => {
        const res = adjacentPhotos(p({ id: "new", createdAt: "2026-03-01" }), all);
        expect(res.prev).toBeNull();
        expect(res.next?.id).toBe("mid");
    });

    it("末尾は next=null", () => {
        const res = adjacentPhotos(p({ id: "old", createdAt: "2026-01-01" }), all);
        expect(res.prev?.id).toBe("mid");
        expect(res.next).toBeNull();
    });

    it("一覧に無ければ両方 null", () => {
        const res = adjacentPhotos(p({ id: "ghost" }), all);
        expect(res).toEqual({ prev: null, next: null });
    });
});
