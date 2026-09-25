import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 🔴 **カテゴリとタグのチップは、同じ見た目でなければならない。**
 *
 * 同じ行に並ぶ同じ形のチップなのに、className を**別々に書いていた**。
 * 板（`PhotoDetail.dc.html`）の寸法（高さ32px・字12px）に寄せたとき
 * 片方だけ直してしまい、**大小のチップが1行に混ざった**——直す前より悪い。
 * いまは `CHIP_CLASS` 1つを両方から使っているが、**それが崩れたら落ちる**
 * ようにしておく。
 *
 * 綴りではなく**出た要素の class が一致すること**で見る。
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
/** 撮影地のチップ（写真の上）。同じ地名が「撮影日 · 撮影地」の行にも出るので、`/location/` を指す a を引く */
const locationHref = (text: string) =>
    screen.getAllByText(text).map((e) => e.closest("a")).find((a) => a?.getAttribute("href")?.includes("/location/"))?.getAttribute("href");
/** 撮影情報は初期は畳まれている（中身は DOM に残る）。リンクの role で引くときは開く */
const expandExif = () => { const b = screen.queryByRole("button", { name: "詳しく見る" }); if (b) fireEvent.click(b); };

describe("チップの見た目", () => {
    it("カテゴリのチップとタグのチップは同じ class を使う", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        const cat = screen.getByText("建物").closest("a");
        const tags = ["#風景", "#高屋神社"].map((t) => screen.getByText(t).closest("a"));
        expect(cat, "カテゴリのチップが見つからない").not.toBeNull();
        for (const t of tags) expect(t, "タグのチップが見つからない").not.toBeNull();
        for (const t of tags) {
            expect(t!.className, "タグとカテゴリで綴りが割れている").toBe(cat!.className);
        }
    });

    it("板の寸法（高さ32px・字12px）を持っている", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        const cls = screen.getByText("#風景").closest("a")!.className;
        // `py-0.5`（高さ17.5px）や `text-xs`（10.5px）に戻ったら落ちる
        expect(cls, "高さが板の32pxでない").toContain("min-h-[32px]");
        expect(cls, "字が板の12pxでない").toContain("text-[12px]");
        expect(cls, "640px 未満で縮む綴りに戻っている").not.toMatch(/\btext-xs\b|\bpy-0\.5\b/);
    });
});
