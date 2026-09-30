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

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: id, ...extra,
} as unknown as Photo);

const render1 = (photos: Photo[], map: Record<string, string> = {}) =>
    render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={map} />);

describe("さがす: 発見の節", () => {
    // 2026-09-30 のレビュー: 長い住所を見出しにしない・地域と場所を見分ける
    it("撮影地のカードは、具体的な部分を見出しに・地域は2行目に（地域の束は「地域」と名乗る）", () => {
        const { container } = render1([
            photo("a", { location: "香川県 観音寺市 高屋神社" }), photo("b", { location: "香川県 観音寺市 高屋神社" }),
            photo("c", { location: "フランス" }),
        ]);
        const cards = [...container.querySelectorAll('a[href*="/location/"]')];
        const takaya = cards.find((a) => (a.textContent ?? "").includes("高屋神社"))!;
        const spans = [...takaya.querySelectorAll("span")].map((s) => s.textContent);
        expect(spans).toContain("高屋神社");
        expect(spans.some((t) => t === "香川県 観音寺市・2枚")).toBe(true);
        const france = cards.find((a) => (a.textContent ?? "").includes("フランス"))!;
        expect([...france.querySelectorAll("span")].map((s) => s.textContent)).toContain("地域・1枚");
    });

    it("撮影地のカード: 地域が長くても枚数は切らない（枚数は省略の外）", () => {
        const { container } = render1([photo("a", { location: "茨城県 ひたちなか市 国営ひたち海浜公園" })]);
        const card = container.querySelector('a[href*="/location/"]')!;
        const count = [...card.querySelectorAll("span")].find((s) => s.textContent === "1枚")!;
        expect(count, "枚数が独立していない").toBeTruthy();
        expect(count.className).toContain("shrink-0");
        expect(count.className).not.toContain("truncate");
    });

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
    // 🔴 **柱（`variant="rail"`）はこの部品から無くなった。**
    //
    // ホームの PC の柱は `app/components/DiscoverRail.tsx` に移り、
    // ここの `rail` は**本体から一度も呼ばれない**枝になっていた。
    // ところが**その性質を守る4本のテストはこちらに残った**ので、
    // 移った先が素の `<a>` に戻っていても誰も落ちず、そのまま本番に出た
    // （2026-09-24・押すたびに HTML を1本落とし直す）。
    //
    // **コードを移したら、守りも一緒に移す。** 4本の性質は
    // `app/components/__tests__/DiscoverRail.test.tsx` が引き継いでいる。
});
