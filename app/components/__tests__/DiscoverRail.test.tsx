import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * **ホームの PC の柱（`DiscoverRail`）。**
 *
 * 🔴 **この部品は、守りを1本も持たないまま本番に出ていた**（2026-09-24）。
 * 柱の中身を `DiscoverSections variant="rail"` から差し替えたとき、
 * **その性質を守っていた4本のテストは、差し替えた側（もう本体から呼ばれない
 * `variant="rail"`）に残ったまま**だった。だから
 * **「柱も `<Link>`」が素の `<a>` に戻っていても、誰も落ちなかった**
 * （押すたびに HTML を1本落とし直す＝gzip 15,477 B ／ `<Link>` の
 * RSC の控えは 3,934 B。`DiscoverSections` が実測して書いている）。
 *
 * **コードを移したら、守りも一緒に移す。** ここはその移し先で、
 * 死んだ側が見ていた4つの性質をそのまま引き継ぐ:
 *
 *   1. 件数を絞る（柱が画面の高さを超えると貼り付きが効かない）
 *   2. 撮影地に「面の中のカード幅（150px）」を持ち込まない
 *   3. **`<Link>`**（素の `<a>` に戻さない）
 *   4. 数えた値は面の中と同じ
 */

vi.mock("../Thumb", () => ({ default: ({ photo }: { photo: Photo }) => <span data-thumb={photo.id} /> }));

/**
 * 🔴 **`<Link>` に印を付けてから数える。**
 *
 * Next の `<Link>` が DOM に出すのは**素の `<a href>`** なので、属性の有無では
 * `<a>` と区別できない（`DiscoverSections.test.tsx` が同じ罠を踏んで、
 * 変異を当てても13件とも緑だった）。**見分けの付く印**を持つ `<a>` に置き換える。
 */
vi.mock("next/link", () => ({
    default: ({ href, children, prefetch, ...rest }: {
        href: string; children: React.ReactNode; prefetch?: boolean;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        // `prefetch` は DOM の属性ではない（撒くと React が警告を出す）
        return <a data-next-link="1" data-prefetch={String(prefetch)}
                  href={typeof href === "string" ? href : ""} {...rest}>{children}</a>;
    },
}));

import DiscoverRail from "../DiscoverRail";
import DiscoverSections from "../../search/DiscoverSections";

const photo = (id: string, extra: Partial<Photo> = {}): Photo =>
    ({ id, src: `https://cdn/${id}.jpg`, title: id, ...extra } as unknown as Photo);

const draw = (photos: Photo[], map: Record<string, string> = {}) =>
    render(<DiscoverRail photos={photos} locale="ja" categoryDisplayMap={map} />);

/** 節の見出しへのリンク（「すべて見る」）を除いた、項目のリンク */
const INDEX_HREFS = ["/location", "/category", "/camera", "/tag"];
const itemLinks = (c: HTMLElement) =>
    [...c.querySelectorAll("a")].filter((a) => !INDEX_HREFS.includes(a.getAttribute("href") ?? ""));

/** 同じ種別の写真を n 種類ぶん作る */
const many = (field: "location" | "category", n: number) =>
    Array.from({ length: n * 2 }, (_, i) =>
        photo(`p${i}`, { [field]: `場所${Math.floor(i / 2)}` } as Partial<Photo>));

describe("柱の中身", () => {
    it("カテゴリ・撮影地・機材の3つの節を出す", () => {
        const { container } = draw([
            photo("a", { category: "landscape", location: "パリ", exif: { camera: "SONY ILCE-7M3" } }),
            photo("b", { category: "landscape", location: "パリ", exif: { camera: "SONY ILCE-7M3" } }),
        ]);
        const text = container.textContent ?? "";
        expect(text).toContain("撮影地からさがす");
        expect(text).toContain("カテゴリからさがす");
        expect(text).toContain("機材からさがす");
    });

    it("🔴 件数を絞る（柱が画面の高さを超えると貼り付きが効かない）", () => {
        const { container } = draw(many("location", 8));
        const spots = itemLinks(container).filter((a) => /location|search\?/.test(a.getAttribute("href") ?? ""));
        expect(spots.length, "柱に8件そのまま出している").toBeLessThanOrEqual(4);
        expect(spots.length, "1件も出ていない（判定が空回りしている）").toBeGreaterThan(0);
    });

    it("🔴 面の中のカード幅（150px）を柱に持ち込まない", () => {
        const { container } = draw([photo("a", { location: "東京" }), photo("b", { location: "東京" })]);
        for (const a of itemLinks(container)) {
            expect(a.getAttribute("style") ?? "", "150px のカードのまま").not.toContain("150px");
        }
    });

    /**
     * 🔴 **これが本番で戻っていた。** 素の `<a>` は押すたびにページ全体を
     * 読み直す（クライアント遷移にならない）。
     */
    it("🔴 項目も「すべて見る」も `<Link>`（素の `<a>` に戻さない）", () => {
        const { container } = draw([
            photo("a", { category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
            photo("b", { category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
        ]);
        const all = [...container.querySelectorAll("a")];
        expect(all.length, "リンクが1本も無い（判定が空回りしている）").toBeGreaterThan(3);
        for (const a of all) {
            expect(a.hasAttribute("data-next-link"), `素の <a> に戻っている: ${a.getAttribute("href")}`).toBe(true);
        }
    });

    /** 公開ページの決まり（`app/__tests__/linkPrefetch.test.ts` と対） */
    it("先読みは切る（公開ページの決まり）", () => {
        const { container } = draw([photo("a", { location: "東京" }), photo("b", { location: "東京" })]);
        for (const a of [...container.querySelectorAll("a")]) {
            expect(a.getAttribute("data-prefetch"), `先読みが入っている: ${a.getAttribute("href")}`).toBe("false");
        }
    });

    it("🔴 数えた値は面の中と同じ（並べ方と行き先だけが違う）", () => {
        const photos = [photo("a", { location: "東京" }), photo("b", { location: "東京" }), photo("c", { location: "パリ" })];
        const rail = draw(photos);
        expect(rail.container.textContent, "柱で数が変わっている").toContain("2枚");
        rail.unmount();
        const page = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} />);
        expect(page.container.textContent, "面の中で数が変わっている").toContain("2枚");
    });

    it("写真が1枚も無ければ、節ごと出さない（空の枠を置かない）", () => {
        const { container } = draw([]);
        expect(container.textContent ?? "", "中身が無いのに見出しだけ出ている").not.toContain("撮影地からさがす");
    });
});

describe("タグの節（検索に載るタグページへの内部リンク・2026-09-29）", () => {
    // ホームの新着を写真の並びにして、カードのタグのリンクが消えた。その受け皿
    const tagged = (tag: string, n: number) =>
        Array.from({ length: n }, (_, i) => photo(`${tag}-${i}`, { tags: [tag] } as Partial<Photo>));

    it("検索に載るタグ（3枚以上）だけを、タグページそのものへのリンクで出す", () => {
        const { container } = draw([...tagged("sauna", 3), ...tagged("igloo", 2)]);
        expect(container.textContent).toContain("タグからさがす");
        const hrefs = [...container.querySelectorAll('section[aria-labelledby="rail-tags"] a')].map((a) => a.getAttribute("href"));
        expect(hrefs).toContain("/tag/sauna");
        expect(hrefs.some((h) => h?.includes("igloo")), "載らないタグ（2枚）へリンクしている").toBe(false);
        // 行き先は /search へ振り替えない（タグページそのものを内部リンクで支える）
        expect(hrefs.some((h) => h?.startsWith("/search")), "検索結果へ振り替えている").toBe(false);
        // 「すべて見る」はタグの一覧
        expect(hrefs).toContain("/tag");
    });

    it("載るタグが1つも無ければ節ごと出さない", () => {
        const { container } = draw(tagged("igloo", 2));
        expect(container.querySelector('section[aria-labelledby="rail-tags"]')).toBeNull();
    });
});
