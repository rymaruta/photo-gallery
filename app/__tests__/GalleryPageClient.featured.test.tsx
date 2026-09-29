import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ja } from "../i18n/labels";

/**
 * **運営が選んだ「おすすめ」**（owner の要望）。
 *
 * owner の新デザインで**トップのタブ**になった（おすすめ／フォロー中／新着）。
 * 見ている性質は変わらない——`PHOTOS` を渡しているか、絞り込み中に
 * 出していないか。まとめ方そのものは `lib/utils/__tests__/featured.test.ts`。
 * 純関数だけ見ていると、画面が呼んでいない変異が素通りする。
 */
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { ...ja, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// グリッドは中身を見ない（カードの作りは `GalleryGrid` 自身のテストが見る）
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));

const PHOTOS = [
    { id: "f1", src: "https://cdn/a.jpg", title: "あ", category: "建物", featured: true, tags: [], createdAt: "2026-01-01" },
    { id: "f2", src: "https://cdn/b.jpg", title: "い", category: "landscape", featured: true, tags: [], createdAt: "2026-01-02" },
    { id: "n1", src: "https://cdn/c.jpg", title: "う", category: "landscape", tags: [], createdAt: "2026-01-03" },
];
const photosRef = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: photosRef.list, loaded: true }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

/** 「おすすめ」タブを開く（未ログインの既定は「新着」） */
function openFeatured() {
    // タブは `role="tab"`（2026-09-22 に `aria-pressed` のボタンから直した）
    fireEvent.click(screen.getByRole("tab", { name: "おすすめ" }));
}

beforeEach(() => { photosRef.list = PHOTOS; window.history.replaceState({}, "", "/"); });

describe("トップの「おすすめ」", () => {
    it("印の付いた写真を、カテゴリごとに出す", () => {
        render(<GalleryPageClient />);
        openFeatured();
        expect(screen.getByRole("heading", { name: "おすすめ" }), "節ごと出ていない").toBeInTheDocument();
        // 別名（建物）も表を通した名前で出る
        expect(screen.getByRole("heading", { name: "建築" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "風景" })).toBeInTheDocument();
    });

    /** おすすめは数枚なので、もっと見たい人の行き先が無いと行き止まりになる */
    it("そのカテゴリの全部へ行ける", () => {
        render(<GalleryPageClient />);
        openFeatured();
        const all = screen.getAllByRole("link", { name: "すべて見る" });
        expect(all.length, "行き先が無い").toBeGreaterThan(0);
        expect(all.map((a) => a.getAttribute("href")).join(" ")).toContain("/category/");
    });

    it("「おすすめ」の並びは、選ばれた写真を先に、残りはいいねの多い順（画面まで配線されている）", () => {
        // f1・f2 は選ばれた写真、n1 は選ばれていない。新着の順（n1, f2, f1）とは違う
        photosRef.list = PHOTOS;
        render(<GalleryPageClient />);
        openFeatured();
        const ids = [...document.querySelectorAll("a[data-photo-id]")].map((a) => a.getAttribute("data-photo-id"));
        expect(ids).toEqual(["f2", "f1", "n1"]);
    });

    it("「おすすめ」には PC の右の柱を付けない（owner の指示 2026-09-22・意図的な実装）", () => {
        render(<GalleryPageClient />);
        openFeatured();
        expect(document.querySelector("main aside"), "おすすめに柱が付いている").toBeNull();
    });

    // 柱が無いぶん中央に置くと、タブを切り替えたときに並びが横へ 160〜224px 跳ねる。
    // 新着（`HomeColumns` の1本目＝PC は左端から 40rem）と同じ位置・同じ幅に置く
    it("「おすすめ」の並びは PC で新着と同じ位置（左寄せ・40rem）", () => {
        render(<GalleryPageClient />);
        openFeatured();
        const box = document.querySelector("a[data-photo-id]")!.closest("ol")!.parentElement!;
        expect(box.className.split(/\s+/)).toEqual(expect.arrayContaining(["lg:mx-0", "lg:max-w-[40rem]"]));
    });

    /** 空の見出しだけが残る形は「準備中」と同じ */
    it("1枚も選ばれていなければ、カテゴリの段は出さず、全部の写真の並びだけ出す（iOS と同じ）", () => {
        photosRef.list = PHOTOS.map((p) => ({ ...p, featured: false }));
        render(<GalleryPageClient />);
        openFeatured();
        expect(screen.queryByRole("heading", { name: "おすすめ" }), "空の節が残っている").toBeNull();
        // **行き止まりにしない**——以前は「まだおすすめは選ばれていません。」だけだった
        expect(screen.queryByText("まだおすすめは選ばれていません。")).toBeNull();
        expect(document.querySelectorAll("a[data-photo-id]").length, "写真の並びが出ていない").toBeGreaterThan(0);
    });

    /**
     * 🔴 **絞り込み中は出さない。** 絞った結果の上に、絞りと関係ない写真が
     * 並ぶと何を見ているか分からなくなる
     */
    it("絞り込み中は出さない", () => {
        window.history.replaceState({}, "", "/?q=%E3%81%82");
        render(<GalleryPageClient />);
        openFeatured();
        expect(screen.queryByRole("heading", { name: "おすすめ" }), "絞り込みの上に無関係な写真が並ぶ").toBeNull();
    });

    it("カテゴリで絞っているときも出さない", () => {
        window.history.replaceState({}, "", "/?category=landscape");
        render(<GalleryPageClient />);
        openFeatured();
        expect(screen.queryByRole("heading", { name: "おすすめ" })).toBeNull();
    });
});
