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
 * `/tag/風景` ＝ **旧URL（canonical が別を指す・索引に載らない側）** を
 * 指していた。写真ページは索引に載るページの約6割で、集約ページへの
 * 内部リンクは**そこからしか出ていない**——寄せた先にリンクが1本も
 * 集まらない状態だった。
 *
 * 種別はスラッグに効く唯一の引数なので、**リンク4種すべて**を見る。
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

    it("撮影地とカメラは別名表を当てずにリンクする", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        expect(hrefOf("この場所の写真"))
            .toBe(collectionPath("location", "香川県-観音寺市-高屋神社"));
        expect(hrefOf("SONY ILCE-7M3")).toBe(collectionPath("camera", "sony-ilce-7m3"));
    });
});
