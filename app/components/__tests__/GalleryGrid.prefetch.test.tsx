import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * **一覧のカードは先読みしない。**
 *
 * Next の `<Link>` は既定で「画面に入ったら先読み」。一覧はカードが30枚あり、
 * 静的書き出しなので先読みの中身は `/photo/<id>.txt`（RSC の控え）で、
 * `deploy-static-site.js` はこれを `no-cache, no-store` で配る
 * ——**カードが画面に出入りするたびに毎回落とし直す**。
 *
 * 実測（`out/` を手元に配り、往復80msを足して5回の中央値）:
 *
 *     先読みあり  142要求 / **1.74 MB**（生）  タップ→表示 150ms
 *     先読みなし    1要求 /    18 KB          タップ→表示 233ms
 *
 * `prefetch` は DOM の属性に出ないので、**`next/link` に渡った値**で見る。
 */
const linkProps = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
vi.mock("next/link", () => ({
    default: (p: Record<string, unknown>) => {
        linkProps.list.push(p);
        return <a href={String(p.href)} data-photo-id={p["data-photo-id"] as string}>{p.children as React.ReactNode}</a>;
    },
}));

const GalleryGrid = (await import("../GalleryGrid")).default;
const { GRID_SIZES_5XL } = await import("../gridSizes");

const photo = (id: string): Photo => ({
    id, src: `https://cdn.example.com/uploads/${id}.jpg`, title: { ja: "写真" }, tags: [],
} as unknown as Photo);

describe("一覧のカードの先読み", () => {
    it("カードのリンクは先読みしない", () => {
        linkProps.list.length = 0;
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={[photo("a"), photo("b")]} locale="ja" />);
        const cards = linkProps.list.filter((p) => p["data-photo-id"]);
        expect(cards.length, "カードのリンクを見つけられていない").toBe(2);
        for (const c of cards) {
            expect(c.prefetch, "画面に入るたびに写真ページの控えを落とし直す").toBe(false);
        }
    });

    // 判定が効くか（`prefetch` は DOM に出ないので、素の描画では見えない）
    it("判定は、先読みが戻ったら見つける", () => {
        expect(linkProps.list.length, "リンクの props を1つも拾えていない").toBeGreaterThan(0);
        expect(linkProps.list.some((p) => p.prefetch === undefined), "既定のまま（先読みあり）のリンクが混ざっている").toBe(false);
    });
});
