import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * **「色でさがす」が、渡された一覧の形で正しく出る／正しく出ない ことの見張り。**
 *
 * この部品は写真を取りに行かない（`GalleryPageClient` から受け取る）。
 * いちばん起きやすい壊れ方は「**何も無いのに枠だけ出る**」——手元の断面
 * （`app/data/photos.json`）は30枚すべてが `dominantColor` を持たないので、
 * 素朴に書くと空のチップが10個並ぶ。そこを固定する。
 * 配線（同じ一覧・同じ `openById` を渡しているか）は
 * `app/__tests__/GalleryPageClient.colorJourney.test.tsx` が見る。
 */

// グリッドの中身はここでは見ない（`GalleryGrid` 自身のテストが在る）。
// 枚数・カテゴリ名の地図・開き方を外に出して、渡っているかを見る
// （地図を渡すのをやめる変異が素通りした回があったので）
vi.mock("../GalleryGrid", () => ({
    default: ({ photos: p, categoryDisplayMap, onOpenPhoto }: { photos: Photo[]; categoryDisplayMap?: Record<string, string>; onOpenPhoto?: (id: string) => boolean }) => (
        <div
            data-testid="grid"
            data-count={p.length}
            data-category-map={JSON.stringify(categoryDisplayMap ?? null)}
            data-has-open={onOpenPhoto ? "yes" : "no"}
            onClick={() => onOpenPhoto?.(p[0]?.id ?? "")}
        />
    ),
}));

const ColorJourney = (await import("../ColorJourney")).default;

const photo = (id: string, dominantColor?: string, category?: string): Photo =>
    ({ id, src: `https://cdn.example.com/uploads/${id}.jpg`, title: { ja: id }, tags: [], ...(dominantColor ? { dominantColor } : {}), ...(category ? { category } : {}) }) as unknown as Photo;

const MAP = { landscape: "風景", architecture: "建築" };
const draw = (photos: Photo[], onOpenPhoto?: (id: string) => boolean) =>
    render(<ColorJourney photos={photos} locale="ja" categoryDisplayMap={MAP} onOpenPhoto={onOpenPhoto} />);

beforeEach(() => cleanup());

describe("色を持つ写真が無いとき", () => {
    it("何も描かない（空のチップを並べない）", () => {
        const { container } = draw([photo("a"), photo("b"), photo("c")]);
        expect(container.firstChild, "色が無いのに何か描いている").toBeNull();
    });
    it("手元の断面と同じ『全部が色なし』でも落ちない", () => {
        const { container } = draw(Array.from({ length: 30 }, (_, i) => photo(`p${i}`)));
        expect(container.firstChild).toBeNull();
    });
    it("空の一覧でも落ちない", () => {
        const { container } = draw([]);
        expect(container.firstChild).toBeNull();
    });
});

describe("最小枚数", () => {
    it("1枚しか無い色のチップは出さない", () => {
        const { container } = draw([photo("a", "#0000ff")]);
        expect(container.firstChild).toBeNull();
    });
    it("2枚あれば出す", () => {
        draw([photo("a", "#0000ff"), photo("b", "#0000ee")]);
        expect(screen.getByRole("button", { name: /青/ })).toBeTruthy();
    });
    it("2枚に満たない色は、足りている色と混ぜても出さない", () => {
        draw([photo("a", "#0000ff"), photo("b", "#0000ee"), photo("c", "#ff0000")]);
        expect(screen.getByRole("button", { name: /青/ })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /赤/ }), "1枚の赤が出ている").toBeNull();
    });
});

describe("チップの操作", () => {
    const five = () => [
        photo("a", "#0000ff"), photo("b", "#0000ee"), photo("c", "#1133dd"),
        photo("d", "#000000"), photo("e", "#111111"),
    ];

    it("見出しは h2（main の中・h1 のあとに置かれる前提）", () => {
        draw(five());
        expect(screen.getByRole("heading", { level: 2, name: "色でさがす" })).toBeTruthy();
    });

    it("最初はどれも選ばれておらず、グリッドも出ない", () => {
        draw(five());
        for (const el of screen.getAllByRole("button")) expect(el.getAttribute("aria-pressed")).toBe("false");
        expect(screen.queryByTestId("grid")).toBeNull();
    });

    it("押すと選ばれ、その色の枚数だけグリッドに渡る", () => {
        draw(five());
        fireEvent.click(screen.getByRole("button", { name: /青/ }));
        expect(screen.getByRole("button", { name: /青/ }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByTestId("grid").getAttribute("data-count")).toBe("3");
    });

    it("押し直すと外れ、グリッドも消える", () => {
        draw(five());
        const blue = screen.getByRole("button", { name: /青/ });
        fireEvent.click(blue);
        expect(screen.getByTestId("grid")).toBeTruthy();
        fireEvent.click(blue);
        expect(screen.getByRole("button", { name: /青/ }).getAttribute("aria-pressed")).toBe("false");
        expect(screen.queryByTestId("grid"), "外したのにグリッドが残っている").toBeNull();
    });

    it("別の色を押すと、そちらに移る（2つ同時に光らない）", () => {
        draw(five());
        fireEvent.click(screen.getByRole("button", { name: /青/ }));
        fireEvent.click(screen.getByRole("button", { name: /黒/ }));
        expect(screen.getByRole("button", { name: /青/ }).getAttribute("aria-pressed")).toBe("false");
        expect(screen.getByRole("button", { name: /黒/ }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByTestId("grid").getAttribute("data-count")).toBe("2");
    });

    it("チップに枚数が出る", () => {
        draw(five());
        expect(screen.getByRole("button", { name: "青 (3)" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "黒 (2)" })).toBeTruthy();
    });

    it("受け取ったカテゴリ名の地図を、そのままグリッドへ渡す", () => {
        draw(five());
        fireEvent.click(screen.getByRole("button", { name: /青/ }));
        expect(JSON.parse(screen.getByTestId("grid").getAttribute("data-category-map")!)).toEqual(MAP);
    });

    /**
     * **開き方を下のグリッドと揃える。** これを渡し忘れると、ビルド後に
     * 上がった写真（静的ページが無い）を押したときにトップへ遷移して開く
     * ——下のグリッドはその場のモーダルなのに（PR #72 の積み残し）。
     */
    it("受け取った onOpenPhoto を、そのままグリッドへ渡す", () => {
        const open = vi.fn(() => true);
        draw(five(), open);
        fireEvent.click(screen.getByRole("button", { name: /青/ }));
        expect(screen.getByTestId("grid").getAttribute("data-has-open")).toBe("yes");
        fireEvent.click(screen.getByTestId("grid"));
        expect(open).toHaveBeenCalledWith("a");
    });
});

describe("チップの並び", () => {
    it("枚数順ではなく COLOR_BUCKETS の順（写真が増えても入れ替わらない）", () => {
        draw([
            photo("k1", "#000000"), photo("k2", "#111111"), photo("k3", "#0a0a0a"),
            photo("b1", "#0000ff"), photo("b2", "#0000ee"),
        ]);
        expect(screen.getAllByRole("button").map((el) => el.getAttribute("aria-label"))).toEqual(["青 (2)", "黒 (3)"]);
    });
});

describe("一覧が入れ替わったとき", () => {
    const withBlue = () => [photo("a", "#0000ff"), photo("b", "#0000ee"), photo("c", "#000000"), photo("d", "#111111")];
    const withoutBlue = () => [photo("a", "#0000ff"), photo("c", "#000000"), photo("d", "#111111")];
    const redraw = (rerender: (ui: React.ReactElement) => void, photos: Photo[]) =>
        rerender(<ColorJourney photos={photos} locale="ja" categoryDisplayMap={MAP} />);

    it("選んだ色が消えたら、グリッドも消える（枠だけ残さない）", () => {
        const { rerender } = draw(withBlue());
        fireEvent.click(screen.getByRole("button", { name: /青/ }));
        expect(screen.getByTestId("grid").getAttribute("data-count")).toBe("2");
        redraw(rerender, withoutBlue());
        expect(screen.queryByRole("button", { name: /青/ }), "消えた色のチップが残っている").toBeNull();
        expect(screen.queryByTestId("grid"), "チップは消えたのにグリッドが残っている").toBeNull();
    });

    it("消えた色が戻っても、選択は戻らない（勝手にグリッドが開かない）", () => {
        const { rerender } = draw(withBlue());
        fireEvent.click(screen.getByRole("button", { name: /青/ }));
        redraw(rerender, withoutBlue());
        expect(screen.queryByTestId("grid")).toBeNull();
        redraw(rerender, withBlue());
        expect(screen.getByRole("button", { name: /青/ }).getAttribute("aria-pressed"), "押していないのに光っている").toBe("false");
        expect(screen.queryByTestId("grid"), "押していないのにグリッドが開いた").toBeNull();
    });

    it("色が全部消えたら、部品ごと消える", () => {
        const { container, rerender } = draw([photo("a", "#0000ff"), photo("b", "#0000ee")]);
        expect(container.firstChild).not.toBeNull();
        redraw(rerender, [photo("a"), photo("b")]);
        expect(container.firstChild).toBeNull();
    });
});
