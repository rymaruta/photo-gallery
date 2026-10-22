import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
        const attrs: Record<string, unknown> = { ...rest };
        delete attrs.prefetch;
        return <a href={href} {...attrs}>{children}</a>;
    },
}));

import { spotAreas, spotIndexItemsForArea, visibleSpotsInArea, type SpotIndexItem } from "../../lib/data/spotLink";
import { topicCardCover } from "../../lib/data/spotTopics";
import { LocaleProvider } from "../i18n/context";
import SpotIndexClient from "../components/SpotIndexClient";

/**
 * 🔴 **県の頁（`/spots/area/<県>`）のカードに写真を出す**（2026-10-22）。
 *
 * 以前は台帳の `coverImage` だけを見ていたので、Commons の代表写真（`spotCoverImage`）を持つ
 * スポットでも県の頁は全部「写真なし」のカードだった。季節・テーマの頁と同じ `topicCardCover`
 * （サムネ・作者・ライセンス・出典）を使う。
 */
describe("県の頁のカードの写真", () => {
    it("全県で、カードの写真は季節・テーマの頁と同じ判断（topicCardCover）", () => {
        let withCover = 0;
        let thumbs = 0;
        for (const a of spotAreas()) {
            const items = spotIndexItemsForArea(a.slug);
            const spots = visibleSpotsInArea(a.slug);
            expect(items.map((i) => i.slug), a.slug).toEqual(spots.map((s) => s.slug));
            items.forEach((item, i) => {
                expect(item.cover, item.slug).toEqual(topicCardCover(spots[i]));
                if (item.cover) withCover++;
                if (item.cover?.src.startsWith("/images/spots/thumb/")) thumbs++;
            });
        }
        // 公開の大半は Commons の代表写真を持つ（0 なら判断が繋がっていない）
        expect(withCover).toBeGreaterThan(100);
        expect(thumbs).toBeGreaterThan(0);
    });

    it("座標は運ばない（画面が読まない）", () => {
        const a = spotAreas()[0];
        for (const item of spotIndexItemsForArea(a.slug)) expect("coords" in item, item.slug).toBe(false);
    });

    it("写真・alt・作者とライセンスの表示（リンクの外）を描く。写真の無いカードは名前だけ", () => {
        const items: SpotIndexItem[] = [
            {
                slug: "with-photo", name: "あぶくま洞", region: "福島県 田村市", stage: "published", category: "鍾乳洞",
                cover: { src: "/images/spots/thumb/abukumado.webp", alt: "あぶくま洞の鍾乳石",
                    credit: { author: "Σ64", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg" } },
            },
            { slug: "no-photo", name: "写真なし", region: "福島県", stage: "published", cover: null },
        ];
        render(<LocaleProvider><SpotIndexClient spots={items} area={{ name: "福島県", nameEn: "Fukushima" }} /></LocaleProvider>);
        const img = screen.getByRole("img", { name: "あぶくま洞の鍾乳石" });
        expect(img.getAttribute("src")).toBe("/images/spots/thumb/abukumado.webp");
        const credit = screen.getByTestId("topic-credit");
        expect(credit.textContent).toContain("Σ64");
        expect(within(credit).getByRole("link", { name: "CC BY 3.0" }).getAttribute("href")).toBe("https://creativecommons.org/licenses/by/3.0/");
        // 出典の表示はカードのリンクの外（リンクの中にリンクを入れない）
        expect(credit.closest("a[href='/spots/with-photo']")).toBeNull();
        expect(screen.getAllByRole("img")).toHaveLength(1);
        expect(screen.getAllByText("写真なし").length).toBeGreaterThan(0);
    });
});
