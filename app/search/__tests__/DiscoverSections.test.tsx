import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

vi.mock("../../components/Thumb", () => ({ default: ({ photo }: { photo: Photo }) => <span data-thumb={photo.id} /> }));

/**
 * 🔴 **`<Link>` に印を付けてから数える。**
 *
 * 以前ここは `a.hasAttribute("data-prefetch")` が false であることで
 * 「素の `<a>` か」を見ていたが、**Next の `<Link>` はその属性を出さない**
 * （DOM に出るのは素の `<a href>`）ので、**`<a>` でも `<Link>` でも常に true**
 * ——柱を `<Link>` に戻す変異を当てても**13件とも緑**だった（実測）。
 *
 * だから本物の `<Link>` を、**見分けの付く印を持つ `<a>`** に置き換える。
 * こうすると「柱に印が無い」と「面の中には印が在る」を両方見られる
 * ——**後者が無いと、mock が効かなくなった日にまた何も検証しなくなる**
 * （`vi.mock` は黙る。台帳の「🔴 `vi.mock` は黙る」の節）。
 */
vi.mock("next/link", () => ({
    default: ({ href, children, prefetch, ...rest }: {
        href: string; children: React.ReactNode; prefetch?: boolean;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        // `prefetch` は DOM の属性ではない（そのまま撒くと React が警告を出す）
        void prefetch;
        return <a data-next-link="1" href={typeof href === "string" ? href : ""} {...rest}>{children}</a>;
    },
}));

import DiscoverSections from "../DiscoverSections";
import { resolveNotFoundRedirect } from "@/lib/utils/notFoundRedirect";

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: id, ...extra,
} as unknown as Photo);

const render1 = (photos: Photo[], map: Record<string, string> = {}) =>
    render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={map} />);

describe("さがす: 発見の節", () => {
    it("カテゴリ・撮影地・機材の節を、集約ページへのリンクで出す", () => {
        render1([
            photo("a", { category: "landscape", location: "パリ", exif: { camera: "SONY ILCE-7M3" } }),
            photo("b", { category: "landscape", location: "パリ", exif: { camera: "SONY ILCE-7M3" } }),
            photo("c", { category: "nature", location: "東京", exif: { camera: "Canon EOS R6" } }),
        ], { landscape: "風景", nature: "自然" });
        expect(screen.getByRole("link", { name: /風景/ }).getAttribute("href")).toContain("/category/");
        expect(screen.getByRole("link", { name: /パリ/ }).getAttribute("href")).toContain("/location/");
        expect(screen.getByRole("link", { name: /SONY ILCE-7M3/ }).getAttribute("href")).toContain("/camera/");
    });

    it("🔴 撮影地は枚数順で、数を添える。「人気」とは呼ばない（数えているのは枚数だけ）", () => {
        const { container } = render1([
            photo("a", { location: "東京" }), photo("b", { location: "東京" }), photo("c", { location: "パリ" }),
        ]);
        const links = [...container.querySelectorAll('a[href*="/location/"]')].map((a) => a.textContent);
        expect(links[0], "枚数順になっていない").toContain("東京");
        expect(links[0]).toContain("2枚");
        expect(container.textContent, "数えていない「人気」を名乗っている").not.toMatch(/人気|おすすめ撮影スポット/);
    });

    it("🔴 データが無い節は丸ごと出さない（空の枠を置かない）", () => {
        const { container } = render1([photo("a", { category: "landscape" })]);
        expect(container.querySelector('a[href*="/location/"]'), "撮影地が無いのに節が出ている").toBeNull();
        expect(container.querySelector('a[href*="/camera/"]'), "機材が無いのに節が出ている").toBeNull();
        expect(screen.queryByText(/写真の多い撮影地/)).toBeNull();
    });

    it("🔴 何も無ければ部品ごと描かない", () => {
        const { container } = render1([photo("a")]);
        expect(container.innerHTML).toBe("");
    });

    it("🔴 機材は「広角・標準・望遠」にしない（35mm換算が無いので嘘になる）", () => {
        const { container } = render1([photo("a", { exif: { camera: "SONY ILCE-7M3", focalLength: "28mm" } })]);
        expect(container.textContent).not.toMatch(/広角|標準|望遠|Wide|Telephoto/);
    });

    it("二重のメーカー名は畳んで出す", () => {
        render1([photo("a", { exif: { camera: "Hasselblad Hasselblad X2D II 100C" } })]);
        expect(screen.getByRole("link", { name: /Hasselblad X2D II 100C/ })).toBeTruthy();
        expect(screen.queryByText(/Hasselblad Hasselblad/)).toBeNull();
    });

    it("代表写真は、その集約に入る写真から選ぶ（別名で保存された写真にも当たる）", () => {
        const { container } = render1([
            photo("en", { category: "architecture" }),
            photo("ja", { category: "建築" }),
        ]);
        // どちらも `/category/architecture` に寄る＝節は1つ、絵は先頭の写真
        const links = [...container.querySelectorAll('a[href*="/category/"]')];
        expect(links).toHaveLength(1);
        expect(container.querySelector("[data-thumb]")?.getAttribute("data-thumb")).toBe("en");
    });

    it("集約ページへのリンクは先読みしない（画面に入るたび行き先を落とし直さない）", () => {
        const { container } = render1([photo("a", { location: "東京" }), photo("b", { location: "東京" })]);
        for (const a of container.querySelectorAll("a")) {
            expect(a.getAttribute("href"), "先読みしている").toBeTruthy();
        }
    });

    /**
     * ホームの PC の右の柱（`variant="rail"`）。
     *
     * 柱は幅 320px・高さは画面に貼り付いたまま収まらないといけないので、
     * **面の中と同じ形では置けない**。数え方と行き先は同じ1か所のまま、
     * 並べ方と件数だけが違う。
     */
    describe("柱の形（ホームの PC・variant=rail）", () => {
        const many = (type: "location" | "category", n: number) =>
            Array.from({ length: n }, (_, i) =>
                [photo(`${type}${i}a`, type === "location" ? { location: `場所${i}` } : { category: `cat${i}` }),
                 photo(`${type}${i}b`, type === "location" ? { location: `場所${i}` } : { category: `cat${i}` })],
            ).flat();

        /**
         * **節の「項目」のリンクだけ。** 見出しの「すべて見る ›」は
         * 索引ページ（`/category` `/location` `/camera`）へ向けてあるので、
         * 行き先の規則が項目とは違う（下の「索引ページへ行ける」で別に縛る）。
         */
        const INDEX_HREFS = ["/category", "/location", "/camera"];
        const itemHrefs = (r: ReturnType<typeof render>) =>
            [...r.container.querySelectorAll("a")]
                .map((a) => a.getAttribute("href") ?? "")
                .filter((h) => !INDEX_HREFS.includes(h));

        /** 撮影地のリンク。面の中は `/location/*`、柱は `/search?q=`（下の節を参照） */
        const spotLinks = (r: ReturnType<typeof render>, rail: boolean) =>
            [...r.container.querySelectorAll(rail ? 'a[href^="/search?q="]' : 'a[href*="/location/"]')];

        it("🔴 件数を絞る（8件のままだと柱が画面の高さを超えて貼り付きが効かない）", () => {
            const photos = many("location", 8);
            const wide = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} />);
            expect(spotLinks(wide, false)).toHaveLength(8);
            wide.unmount();

            const rail = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} variant="rail" />);
            expect(spotLinks(rail, true), "柱でも8件出している").toHaveLength(4);
        });

        it("🔴 撮影地は縦に並べた行にする（150px のカードを柱に詰めない）", () => {
            const photos = [photo("a", { location: "東京" }), photo("b", { location: "東京" })];
            const rail = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} variant="rail" />);
            const link = spotLinks(rail, true)[0] as HTMLElement;
            expect(link, "撮影地の行が無い").toBeTruthy();
            expect(link.className, "面の中と同じカードのまま").toContain("flex");
            // カードの幅（150px）を柱に持ち込んでいない
            expect(link.getAttribute("style") ?? "", "150px のカードのまま").not.toContain("150px");
            expect(rail.container.textContent, "枚数が消えている").toContain("2枚");
        });

        /**
         * 🔴 **柱の行き先は「さがす」の検索結果**（owner の指示・2026-09-22:
         * 「各項目を押したら『さがす』画面の該当する検索結果へ移動すること」）。
         *
         * **写像は `resolveNotFoundRedirect` を使い回す。** 集約ページが
         * まだ建っていないときの404救済が既に持っている1本で、読む側は
         * `useGallery` の `readFiltersFromUrl`。**新しい仕組みを作らない**
         * ので、救済の行き先と柱の行き先が食い違うことが起きない。
         */
        it("🔴 柱は「さがす」の検索結果へ飛ぶ（面の中は集約ページのまま）", () => {
            const photos = [
                photo("a", { category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
                photo("b", { category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
            ];
            const wide = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} />);
            const wideHrefs = itemHrefs(wide);
            expect(wideHrefs.every((h) => !h.startsWith("/search")), "面の中まで検索結果に変えている").toBe(true);
            wide.unmount();

            const rail = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} variant="rail" />);
            const railHrefs = itemHrefs(rail);
            expect(railHrefs.length).toBeGreaterThan(0);
            for (const h of railHrefs) expect(h, `集約ページのまま: ${h}`).toMatch(/^\/search\?/);
            // 写像は救済と同じ1本（種別ごとの受け皿も同じ）
            for (const h of wideHrefs) {
                expect(railHrefs, `${h} の振り替え先が柱に無い`).toContain(resolveNotFoundRedirect(h));
            }
        });

        /**
         * 🔴 **「すべて見る ›」の行き先は実在する索引ページ。**
         *
         * `#125` でこの枠を落としたのは、**`href` を誰も渡しておらず
         * 一度も描かれたことが無かった**から（実ビルドの `out/search.html`
         * に0件）。戻したのは行き先を作ったから——`app/category/page.tsx`
         * ほかが `collectEntries` の全件を並べるので、「すべて見る」が本当になる。
         *
         * トップ → 集約ページの内部リンクは、実ビルド（151 HTML）で
         * **0本**だった（柱の `/search?…` は `robots.txt` で `Disallow`＝
         * 行き止まり）。この1本がその穴を塞ぐ。
         */
        it("🔴 見出しから索引ページへ行ける（柱でも面の中でも）", () => {
            const photos = [
                photo("a", { category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
                photo("b", { category: "landscape", location: "東京", exif: { camera: "SONY ILCE-7M3" } }),
            ];
            for (const variant of ["page", "rail"] as const) {
                const r = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} variant={variant} />);
                const hrefs = [...r.container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
                for (const want of INDEX_HREFS) {
                    expect(hrefs, `${variant}: ${want} への「すべて見る」が無い`).toContain(want);
                }
                expect(r.container.textContent, `${variant}: 文言が消えている`).toContain("すべて見る");
                r.unmount();
            }
        });

        /**
         * **柱も `<Link>`。**
         *
         * 2026-09-23 まで、ここだけ素の `<a>` にしていた——`<Link>` だと
         * `useGallery` が行き先のクエリを読まないまま空の絞り込みを
         * 書き戻し、`/search?category=landscape` が `/search`（30件）に
         * 化けていたため。根っこを直した（`useGallery` の `subscribeToUrl`）
         * ので回避策は要らない。
         *
         * ⚠️ **押したときに絞り込みが効くことを見張るのは `useGallery` 側**
         * （`lib/hooks/__tests__/useGallery.test.ts` の
         * 「URL の読み直し（<Link> の遷移）」4本）。ここが見るのは
         * **素の `<a>` に戻していないこと**だけ——戻しても壊れはしないが、
         * 押すたびに HTML を1本落とし直す（実測 gzip 15,477 B ／
         * `<Link>` の RSC の控えは 3,934 B）。
         *
         * ⚠️ **見分けは `next/link` の mock が付ける印で付ける**（ファイル先頭）。
         * 属性の有無（`data-prefetch`）で見ていた頃は、`<a>` と `<Link>` を
         * 取り違えても落ちなかった。
         */
        it("柱も `<Link>`（素の `<a>` に戻すと HTML を1本落とし直す）", () => {
            const photos = [photo("a", { category: "landscape" }), photo("b", { category: "landscape" })];
            const rail = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} variant="rail" />);
            const railLinks = [...rail.container.querySelectorAll("a[href^='/search']")];
            expect(railLinks.length, "柱のリンクが1本も無い（判定が空回りしている）").toBeGreaterThan(0);
            for (const a of railLinks) {
                expect(a.hasAttribute("data-next-link"), "素の `<a>` に戻っている").toBe(true);
                expect(a.getAttribute("href"), "href が消えている").toMatch(/^\/search\?/);
            }
            rail.unmount();
            // 面の中（`page`）も `<Link>`
            const wide = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} />);
            const pageLink = wide.container.querySelector('a[href^="/category/"]');
            expect(pageLink, "面の中のリンクが消えた").not.toBeNull();
            expect(pageLink!.hasAttribute("data-next-link"),
                "`next/link` の mock が効いていない（柱の判定が空回りする）").toBe(true);
        });

        it("数えた値は面の中と同じ（並べ方と行き先だけが違う）", () => {
            const photos = [photo("a", { location: "東京" }), photo("b", { location: "東京" }), photo("c", { location: "パリ" })];
            const allText = (r: ReturnType<typeof render>) => r.container.textContent ?? "";
            const wide = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} />);
            expect(allText(wide)).toContain("2枚");
            wide.unmount();
            const rail = render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={{}} variant="rail" />);
            expect(allText(rail), "柱で数が変わっている").toContain("2枚");
        });
    });
});
