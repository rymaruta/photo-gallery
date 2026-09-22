import React from "react";
import { describe, it, expect, vi } from "vitest";
import type { Photo } from "@/lib/data/photos";

/**
 * 🔴 **配線は「呼んでいるか」ではなく「出たもの」で見る。**
 *
 * `viewerFields.test.ts` は**項目の一覧**（`VIEWER_KEPT_FIELDS`）と
 * `GalleryModal` が読むものを突き合わせるが、**その一覧を実際に通したか**は
 * 見ない。実測（2026-09-22・レビューで指摘され、自分で再現した）:
 *
 *     VIEWER_FIELDS から "description" を落とす        → 2件落ちる（効く）
 *     `SpotPage` の呼び出しを slimForViewer → slimForGrid
 *                                                      → **47件 緑のまま**
 *
 * つまり**同じ不具合が再発しても捕まらない**。`related.ts` の
 * `initialRelatedFor` が「`map(slimForLinks)` を1つ消しても誰も気づかない」と
 * 書いている、まさにその形を自分で作っていた。
 *
 * だからここでは**サーバーコンポーネントを実際に呼んで、`SpotPageClient` に
 * 渡った `photos` の中身**を見る。絞り方を戻せば落ちる。
 */

const PHOTOS: Photo[] = [
    {
        id: "p1",
        src: "https://cdn.example.com/uploads/p1.jpg",
        srcAvif: "https://cdn.example.com/uploads/p1_lg.avif",
        title: "パリの街角",
        location: "パリ",
        description: "石畳の朝。",
        exif: { camera: "SONY ILCE-7M3" },
        userId: "u1",
        displayName: "旅人",
        commentCount: 2,
        likes: 3,
        coords: { lat: 48.86, lng: 2.35 },
        geoApprox: true,
        tags: ["street"],
    },
    {
        id: "p2",
        src: "https://cdn.example.com/uploads/p2.jpg",
        title: "夜のセーヌ",
        location: "パリ",
        description: "川沿いの灯り。",
        exif: { camera: "SONY ILCE-7M3" },
        userId: "u1",
        tags: ["night"],
    },
    // **「ほかにこんな写真も」の材料。** これが無いと `nearbyPhotos` が
    // 空になり、下の見張りが**ループを一度も回さず素通りする**
    // （実際に一度そうなった——`slimForViewer` に変えても緑だった）
    { id: "q1", src: "https://cdn.example.com/uploads/q1.jpg", title: "リヨンの朝",
      location: "リヨン", description: "市場の湯気。", exif: { camera: "SONY ILCE-7M3" },
      userId: "u1", tags: ["street"] },
    { id: "q2", src: "https://cdn.example.com/uploads/q2.jpg", title: "ニースの海",
      location: "ニース", description: "夕方の波。", exif: { camera: "SONY ILCE-7M3" },
      userId: "u1", tags: ["night"] },
] as unknown as Photo[];

vi.mock("@/lib/server/photos", () => ({ loadAllPhotos: async () => PHOTOS }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

const SpotPage = (await import("../SpotPage")).default;

/** 返ってきた木から `SpotPageClient` に渡った props を取り出す */
async function propsForClient(slug: string): Promise<Record<string, unknown>> {
    const tree = (await SpotPage({ slug })) as React.ReactElement;
    const children = React.Children.toArray(
        (tree.props as { children?: React.ReactNode }).children,
    ) as React.ReactElement[];
    const client = children.find(
        (c) => React.isValidElement(c) && typeof c.type !== "string"
            && (c.props as Record<string, unknown>).photos !== undefined,
    );
    if (!client) throw new Error("SpotPageClient が見つからない");
    return client.props as Record<string, unknown>;
}

describe("SpotPage の配線", () => {
    it("ビューアが読む項目が、実際に `photos` へ載っている", async () => {
        const props = await propsForClient("パリ");
        const photos = props.photos as Array<Record<string, unknown>>;
        expect(photos.length, "撮影地に写真が当たっていない（この見張りが空回りする）")
            .toBeGreaterThan(0);
        // **落ちていたら黙って空になる項目**（2026-09-22 の不具合そのもの）
        for (const key of ["description", "exif", "userId", "srcAvif", "coords", "geoApprox"]) {
            expect(photos[0], `${key} が渡っていない＝ビューアで黙って空になる`).toHaveProperty(key);
        }
    });

    // **「ほかにこんな写真も」は格子から個別ページへ行くだけ**なので、
    // そちらは絞ったままでよい（重くしない）
    it("「ほかにこんな写真も」は格子の絞りのまま（重くしない）", async () => {
        const props = await propsForClient("パリ");
        const nearby = props.nearbyPhotos as Array<Record<string, unknown>>;
        // **突き合わせる対象が実際にあること。** 空だとループを回さずに
        // 通ってしまう（`photoIndexParity.test.ts` と同じ構え）
        expect(nearby.length, "「ほかにこんな写真も」が空＝この見張りが空回りしている")
            .toBeGreaterThan(0);
        for (const p of nearby) expect(p).not.toHaveProperty("description");
    });

    // **先読みの指定（`priorityCount`）はここでは見ない。**
    // あれは `SpotPageClient` が `GalleryGrid` へ渡すもので、この木には
    // 現れない——`SpotPageClient.test.tsx` の「格子に『先読みしない』を
    // 頼んでいる」が見ている。**ここに書くと `photos` が真かどうかしか
    // 見ない空のテストになる**（実際に一度書いて消した）
});
