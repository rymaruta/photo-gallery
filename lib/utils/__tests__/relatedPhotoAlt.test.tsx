import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Photo } from "../../data/photos";

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
        const attrs: Record<string, unknown> = { ...rest };
        delete attrs.prefetch;
        return <a href={href} {...attrs}>{children}</a>;
    },
}));

import { relatedPhotoAlt } from "../photoAlt";
import { initialRelatedFor } from "../related";
import RelatedPhotos from "../../../app/components/RelatedPhotos";

/**
 * 🔴 **写真ページの回遊リンクの alt に名前を入れる**（2026-10-22）。
 *
 * 本番の写真ページで関連写真の alt が「写真」だけ4枚あった。回遊リンクに渡す写真
 * （`slimForLinks`）が `location` と `alt` を落としていたので、題の無い写真は
 * 撮影地があっても「写真」になっていた。
 */
const base = { src: "https://journey-photo.com/uploads/u/a.jpg", userId: "u1", published: true } as const;
const p = (id: string, over: Record<string, unknown> = {}) => ({ ...base, id, ...over }) as unknown as Photo;

describe("relatedPhotoAlt", () => {
    it("alt → 題（撮影地）→「撮影地の写真」の順。決まり文句しか残らないときだけ文脈に替える", () => {
        expect(relatedPhotoAlt(p("a", { alt: { ja: "焚き火の炎" } }), "ja", "Xさんの写真")).toBe("焚き火の炎");
        expect(relatedPhotoAlt(p("a", { title: "焚き火", location: "道の駅 益子" }), "ja")).toBe("焚き火（道の駅 益子）");
        // 撮影地だけの写真は「撮影地の写真」（最初の区切りまで・`fallbackPhotoTitle`）
        expect(relatedPhotoAlt(p("a", { location: "板橋区, 日本" }), "ja", "Xさんの写真")).toBe("板橋区の写真");
        expect(relatedPhotoAlt(p("a"), "ja", "luzhjさんの写真")).toBe("luzhjさんの写真");
        expect(relatedPhotoAlt(p("a"), "en", "Photo by luzhj")).toBe("Photo by luzhj");
        expect(relatedPhotoAlt(p("a"), "ja")).toBe("写真");
    });
});

describe("回遊リンクに渡す写真が alt の材料を持つ", () => {
    it("題の無い写真でも、撮影地から「〇〇の写真」になる（関連・近く・前後）", () => {
        const all = [
            p("cur", { title: "今の写真", location: "益子町", createdAt: "2026-01-03T00:00:00Z" }),
            p("r1", { location: "益子町", createdAt: "2026-01-02T00:00:00Z" }),
            p("r2", { location: "益子町", alt: { ja: "陶器の窯" }, createdAt: "2026-01-01T00:00:00Z" }),
        ];
        const rel = initialRelatedFor(all[0], all, 8);
        const linked = [...rel.author, ...rel.location, rel.prev, rel.next].filter(Boolean) as Photo[];
        expect(linked.length).toBeGreaterThan(0);
        for (const x of linked) expect(relatedPhotoAlt(x, "ja"), x.id).not.toBe("写真");
        const r2 = linked.find((x) => x.id === "r2")!;
        expect(relatedPhotoAlt(r2, "ja")).toBe("陶器の窯");
    });

    it("RelatedPhotos は alt に名前を入れる（題・撮影地が無ければ fallbackAlt）", () => {
        const { container } = render(
            <RelatedPhotos title="luzhjさんの他の写真" locale="ja" fallbackAlt="luzhjさんの写真"
                photos={[p("a", { location: "飯山市, 日本" }), p("b")]} />,
        );
        // jsdom は画像を読めないので Thumb は「読めなかった」形（role="img" と aria-label に同じ alt）になる
        const alts = Array.from(container.querySelectorAll("img[alt], [role=img]"))
            .map((i) => i.getAttribute("alt") || i.getAttribute("aria-label")).filter(Boolean);
        expect(alts).toEqual(["飯山市の写真", "luzhjさんの写真"]);
    });
});
