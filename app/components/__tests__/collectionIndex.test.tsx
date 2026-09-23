import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "../../../lib/data/photos";

/**
 * 🔴 **索引ページ**（`/category` `/location` `/camera`）。
 * 「すべて見る ›」の行き先で、**トップから集約ページへ渡る唯一の1本**。
 *
 * 足した理由（2026-09-22・実ビルド151 HTML で数えた）:
 *
 *     トップ → /category/*   0本      トップ → /tag/*  49本
 *     トップ → /location/*   0本      （写真カードのタグのチップ）
 *     トップ → /camera/*     0本
 *
 * 柱の項目は owner の指示で `/search?…` を向いていて、その `/search` は
 * **`robots.txt` で `Disallow`**＝検索エンジンから見ると行き止まり。
 *
 * ⚠️ **「集約ページが孤立していた」わけではない**（同じ実測で、noindex でない
 * 60ページのうち `/category/*` へ37・`/location/*` へ22・`/camera/*` へ34 が
 * 張っている＝主に写真ページから）。足りなかったのはトップからの1本と、
 * 「すべて見る」の行き先そのもの。
 *
 * **枠だけ置かない**（`#125` で落とした死にコードと同じ形に戻さない）ので、
 * ここでは**全件が実際に並ぶこと**まで見る。
 */
const P = (o: Partial<Photo>): Photo => ({
    src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x-512.webp",
    createdAt: "2026-01-01T00:00:00Z",
    ...o,
} as Photo);

const photos: Photo[] = [
    // カテゴリ landscape = 3枚（`MIN_INDEXABLE_COUNT` を超える）
    P({ id: "a", category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
    P({ id: "b", category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
    P({ id: "c", category: "landscape", location: "パリ", exif: { camera: "SONY ILCE-7M3" } }),
    // 1枚しか無い＝検索には載らないが、索引には並ぶ
    P({ id: "d", category: "food", location: "大阪", exif: { camera: "Canon EOS R6" } }),
    P({ id: "e", category: "nature", location: "札幌", exif: { camera: "Nikon Z6" } }),
];

vi.mock("../../../lib/server/photos", () => ({ loadAllPhotos: async () => photos }));

const CollectionIndexPage = (await import("../CollectionIndexPage")).default;
const { collectEntries, collectionPath } = await import("../../../lib/utils/collections");

const hrefsOf = (c: HTMLElement) =>
    [...c.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");

describe("索引ページ（すべて見るの行き先）", () => {
    for (const type of ["category", "location", "camera"] as const) {
        it(`${type}: そのキーの全件が並び、集約ページへ張っている`, async () => {
            const { container } = render(await CollectionIndexPage({ type }) as React.ReactElement);
            const entries = collectEntries(photos, type);
            // 走査が空回りしていないこと（0件を「全部出した」と読ませない）
            expect(entries.length, "テストのデータで1件も数えられていない").toBeGreaterThan(1);
            const hrefs = hrefsOf(container);
            for (const e of entries) {
                expect(hrefs, `${e.slug} が索引に無い`).toContain(collectionPath(type, e.slug));
            }
            // 「すべて」なので、数も一致する（ホームへの1本ぶんだけ多い）
            const toCollection = hrefs.filter((h) => h.startsWith(`/${type}/`));
            expect(toCollection.length, "一部しか並べていない").toBe(entries.length);
        });
    }

    it("枚数を添える（押す前にどれが厚いか分かる）", async () => {
        const { container } = render(await CollectionIndexPage({ type: "category" }) as React.ReactElement);
        const landscape = [...container.querySelectorAll("a")]
            .find((a) => a.getAttribute("href") === collectionPath("category", "landscape"));
        expect(landscape, "landscape のリンクが無い").toBeTruthy();
        expect(landscape!.textContent, "枚数が出ていない").toContain("3");
    });

    // **検索に載る線を画面にも書く。** 索引には全件並ぶが、写真が少ない
    // ページは `noindex`（`isIndexableCollection`）。food と nature は1枚ずつ
    it("検索に載せている件数を書いている", async () => {
        render(await CollectionIndexPage({ type: "category" }) as React.ReactElement);
        expect(screen.getByText(/検索に載せているのは 1 件/), "線の説明が出ていない").toBeInTheDocument();
    });

    it("見出しは1つで、パンくずからホームへ戻れる", async () => {
        const { container } = render(await CollectionIndexPage({ type: "location" }) as React.ReactElement);
        expect(container.querySelectorAll("h1")).toHaveLength(1);
        expect(hrefsOf(container), "ホームへ戻れない").toContain("/");
    });

    /**
     * **先読みしない**（公開ページの `<Link>` は全部そう。`app/__tests__/linkPrefetch.test.ts`
     * が `app/**` を走査して見ている）。ここでは「リンクが本当に出ている」ことだけ確かめる
     * ——0本でも上の `toContain` は落ちるが、こちらは自己点検として残す
     */
    it("リンクが1本も無い形になっていない（空回りの検出）", async () => {
        const { container } = render(await CollectionIndexPage({ type: "camera" }) as React.ReactElement);
        expect(hrefsOf(container).filter((h) => h.startsWith("/camera/")).length).toBeGreaterThan(1);
    });
});
