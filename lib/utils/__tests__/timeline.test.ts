import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/data/photos";
import { timelinePhotos } from "../timeline";

// owner の「自分のとフォローしてる人の混ざってる」への答え。
// **中身の決め方（誰の・どの順）はここ1つ**で、画面はこれを並べるだけ。

const P = (o: Partial<Photo> & { id: string }): Photo => ({ src: `https://cdn/${o.id}.jpg`, ...o });

describe("timelinePhotos", () => {
    it("フォローしている人の写真だけ（自分・他人は入らない）", () => {
        const photos = [
            P({ id: "a1", userId: "A", createdAt: "2026-09-01" }),
            P({ id: "b1", userId: "B", createdAt: "2026-09-02" }),
            P({ id: "me1", userId: "me", createdAt: "2026-09-03" }),
            P({ id: "none", createdAt: "2026-09-04" }),                  // userId 無し
        ];
        expect(timelinePhotos(photos, new Set(["A"])).map((p) => p.id)).toEqual(["a1"]);
    });

    it("誰もフォローしていなければ空", () => {
        expect(timelinePhotos([P({ id: "a1", userId: "A" })], new Set())).toEqual([]);
    });

    it("非公開は出さない", () => {
        const photos = [
            P({ id: "pub", userId: "A", createdAt: "2026-09-01" }),
            P({ id: "hidden", userId: "A", createdAt: "2026-09-02", published: false }),
        ];
        expect(timelinePhotos(photos, new Set(["A"])).map((p) => p.id)).toEqual(["pub"]);
    });

    // **投稿順であって撮影順ではない。** 2019年に撮った写真を今日上げたら
    // 今日の位置。撮影日で並べると古い旅の写真ほど沈んで流れてこない
    it("投稿の新しい順（撮影日が古くても、いま上げたものが先頭）", () => {
        const photos = [
            P({ id: "old-shot-new-post", userId: "A", date: "2019-05-01", createdAt: "2026-09-10T10:00:00" }),
            P({ id: "new-shot-old-post", userId: "A", date: "2026-09-09", createdAt: "2026-09-01T10:00:00" }),
            P({ id: "mid", userId: "B", date: "2026-09-05", createdAt: "2026-09-05T10:00:00" }),
        ];
        expect(timelinePhotos(photos, new Set(["A", "B"])).map((p) => p.id))
            .toEqual(["old-shot-new-post", "mid", "new-shot-old-post"]);
    });

    it("createdAt を持たない古い行は date に落とし、同時刻は id で必ず決まる", () => {
        const photos = [
            P({ id: "z", userId: "A", createdAt: "2026-09-01T00:00:00" }),
            P({ id: "y", userId: "A", createdAt: "2026-09-01T00:00:00" }),
            P({ id: "legacy", userId: "A", date: "2026-09-02" }),
        ];
        const out = timelinePhotos(photos, new Set(["A"])).map((p) => p.id);
        expect(out).toEqual(["legacy", "y", "z"]);
        // 入力の順を入れ替えても同じ答え
        expect(timelinePhotos([...photos].reverse(), new Set(["A"])).map((p) => p.id)).toEqual(out);
    });

    it("引数の配列を並べ替えない", () => {
        const photos = [
            P({ id: "1", userId: "A", createdAt: "2026-09-01" }),
            P({ id: "2", userId: "A", createdAt: "2026-09-02" }),
        ];
        const before = photos.map((p) => p.id);
        timelinePhotos(photos, new Set(["A"]));
        expect(photos.map((p) => p.id)).toEqual(before);
    });
});
