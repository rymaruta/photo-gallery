import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { collectionPath } from "@/lib/utils/collections";

/**
 * **写真ページから集約ページへのリンクは、統合後のURLを指す。**
 *
 * `slugify` は**第2引数に種別を渡したときだけ**別名表（`風景 → landscape`）を
 * 引く。タグのリンクだけ渡し忘れていたので、写真ページのタグは全部
 * `/tag/風景`＝**統合前のURL**を指していた。あちらのページは
 * `photosInCollection` が統合後で数えるので中身も枚数も同じだが、
 * **canonical は `/tag/landscape` を指す**——つまり「この URL は正規では
 * ない」と自分で申告しているページへ、内部リンクを集めていた。
 * 写真ページは索引に載るページの約6割で、そこからのリンクが
 * 統合後のページに1本も入らない状態だった
 * （集約ページどうしの相互リンク〈`relatedEntries`〉は統合後を指すので
 *  「1本も無い」のはあくまで写真ページ由来のぶん）。
 *
 * **種別が効くのは `category` と `tag` だけ**（`slugify` の別名表の行）。
 * `location`・`camera` に渡しても値は変わらないので、そこは
 * 「**別名表を当てない**」ことの方を見る——撮影地に `建物` という地名が
 * 入っても `/location/建物` のままであること。
 */
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));
vi.mock("../../../../lib/utils/music", () => ({ searchSongs: vi.fn(), parseMusicEmbed: () => null }));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

// 別名表に**載っている**日本語を、タグにもカテゴリにも入れる。
// 載っていない語（高屋神社）だと、種別を渡しても渡さなくても同じ値になり
// 変異が素通りする
const photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/owner-1/a.jpg",
    userId: "owner-1",
    title: "テスト写真",
    category: "建物",
    tags: ["風景", "高屋神社"],
    location: "香川県 観音寺市 高屋神社",
    exif: { camera: "SONY ILCE-7M3" },
} as unknown as Photo;

const hrefOf = (text: string | RegExp) => screen.getByText(text).closest("a")?.getAttribute("href");

describe("集約ページへの内部リンク", () => {
    it("タグは統合後のURLを指す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        expect(hrefOf("#風景"), "旧URL（canonical が別を指す側）へリンクしている")
            .toBe(collectionPath("tag", "landscape"));
        // 表に無いタグはそのまま（寄せすぎていない）
        expect(hrefOf("#高屋神社")).toBe(collectionPath("tag", "高屋神社"));
    });

    it("カテゴリは統合後のURLを指す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        // チップの字は写真が持っている値のまま（`labels` をモックしているので素の値）
        expect(hrefOf("建物"), "建物 が architecture に寄っていない")
            .toBe(collectionPath("category", "architecture"));
    });

    // **表に載っている語を撮影地に入れる。** 載っていない語（高屋神社）だと
    // 別名表を当てても当てなくても同じ値になり、何も確かめていない
    it("撮影地には別名表を当てない", async () => {
        const placed = { ...photo, location: "建物" } as unknown as Photo;
        render(<PhotoPageClient photoId="p1" initialPhoto={placed} />);
        await screen.findByText("テスト写真");
        expect(hrefOf("この場所の写真"), "地名を architecture に寄せている")
            .toBe(collectionPath("location", "建物"));
    });

    it("カメラは保存済みの機種名からリンクする", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        expect(hrefOf("SONY ILCE-7M3")).toBe(collectionPath("camera", "sony-ilce-7m3"));
        expect(hrefOf("この場所の写真"))
            .toBe(collectionPath("location", "香川県-観音寺市-高屋神社"));
    });
});
