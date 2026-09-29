import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/data/photos";
import { recommendedOrder } from "../homeFeed";

const p = (id: string, over: Partial<Photo> = {}): Photo =>
    ({ id, src: "", title: id, category: "travel", tags: [], ...over } as Photo);
const ids = (xs: Photo[]) => xs.map((x) => x.id);

describe("recommendedOrder（iOS の HomeFeed.arrange(.recommended) と同じ）", () => {
    it("選ばれた写真を先に、残りはいいねの多い順", () => {
        const out = recommendedOrder([
            p("a", { likes: 5 }), p("f1", { featured: true, likes: 0 }), p("b", { likes: 9 }), p("f2", { featured: true, likes: 3 }),
        ]);
        expect(ids(out)).toEqual(["f2", "f1", "b", "a"]);
    });

    it("同点は新しい順。いいねを持たない写真は 0 として数える", () => {
        const out = recommendedOrder([
            p("old", { createdAt: "2026-01-01T00:00:00Z" }),
            p("new", { createdAt: "2026-03-01T00:00:00Z", likes: 0 }),
            p("mid", { createdAt: "2026-02-01T00:00:00Z" }),
            p("liked", { createdAt: "2025-01-01T00:00:00Z", likes: 1 }),
        ]);
        expect(ids(out)).toEqual(["liked", "new", "mid", "old"]);
    });

    it("同点は**投稿日**で決める。撮影日（date）が先の新着とは違う並び", () => {
        // 撮影日と投稿日が逆向きの2枚。新着（compareNewest）なら撮影の新しい old-post が先
        const out = recommendedOrder([
            p("old-post", { date: "2026-05-01", createdAt: "2026-01-01T00:00:00Z" }),
            p("new-post", { date: "2025-01-01", createdAt: "2026-03-01T00:00:00Z" }),
        ]);
        expect(ids(out)).toEqual(["new-post", "old-post"]);
    });

    it("日付の無い写真は同点の末尾", () => {
        expect(ids(recommendedOrder([p("x"), p("y", { createdAt: "2026-01-01T00:00:00Z" })]))).toEqual(["y", "x"]);
    });

    it("元の配列を並べ替えない", () => {
        const input = [p("a", { likes: 1 }), p("b", { likes: 2 })];
        recommendedOrder(input);
        expect(ids(input)).toEqual(["a", "b"]);
    });
});
