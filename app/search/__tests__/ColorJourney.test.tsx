import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { ja } from "@/app/i18n/labels";

/**
 * **「色でさがす」が、実データの形で正しく出る／正しく出ない ことの見張り。**
 *
 * この機能でいちばん起きやすい壊れ方は「**何も無いのに枠だけ出る**」——
 * 手元の断面（`app/data/photos.json`）は30枚すべてが `dominantColor` を
 * 持たないので、素朴に書くと空のチップが10個並ぶ。そこを固定する。
 */

/** テストごとに差し替える写真 */
let photos: Photo[] = [];

vi.mock("../../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ photos, loaded: true, failed: false }),
}));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: ja }) }));
// グリッドの中身はここでは見ない（`GalleryGrid` 自身のテストが在る）。
// **枚数だけ数えられる形**にして、選んだ色のぶんが渡っているかを見る
vi.mock("../../components/GalleryGrid", () => ({
    default: ({ photos: p }: { photos: Photo[] }) => (
        <div data-testid="grid" data-count={p.length} />
    ),
}));

const ColorJourney = (await import("../ColorJourney")).default;

const photo = (id: string, dominantColor?: string): Photo =>
    ({ id, src: `https://cdn.example.com/uploads/${id}.jpg`, title: { ja: id }, tags: [], ...(dominantColor ? { dominantColor } : {}) }) as unknown as Photo;

beforeEach(() => {
    cleanup();
    photos = [];
});

describe("色を持つ写真が無いとき", () => {
    it("何も描かない（空のチップを並べない）", () => {
        photos = [photo("a"), photo("b"), photo("c")];
        const { container } = render(<ColorJourney />);
        expect(container.firstChild, "色が無いのに何か描いている").toBeNull();
    });

    it("手元の断面と同じ『全部が色なし』でも落ちない", () => {
        photos = Array.from({ length: 30 }, (_, i) => photo(`p${i}`));
        const { container } = render(<ColorJourney />);
        expect(container.firstChild).toBeNull();
    });
});

describe("最小枚数", () => {
    it("1枚しか無い色のチップは出さない", () => {
        photos = [photo("a", "#0000ff")];
        const { container } = render(<ColorJourney />);
        expect(container.firstChild).toBeNull();
    });

    it("2枚あれば出す", () => {
        photos = [photo("a", "#0000ff"), photo("b", "#0000ee")];
        render(<ColorJourney />);
        expect(screen.getByRole("switch", { name: /青/ })).toBeTruthy();
    });

    it("2枚に満たない色は、足りている色と混ぜても出さない", () => {
        photos = [photo("a", "#0000ff"), photo("b", "#0000ee"), photo("c", "#ff0000")];
        render(<ColorJourney />);
        expect(screen.getByRole("switch", { name: /青/ })).toBeTruthy();
        expect(screen.queryByRole("switch", { name: /赤/ }), "1枚の赤が出ている").toBeNull();
    });
});

describe("チップの操作", () => {
    beforeEach(() => {
        photos = [
            photo("a", "#0000ff"), photo("b", "#0000ee"), photo("c", "#1133dd"),
            photo("d", "#000000"), photo("e", "#111111"),
        ];
    });

    it("最初はどれも選ばれておらず、グリッドも出ない", () => {
        render(<ColorJourney />);
        for (const el of screen.getAllByRole("switch")) {
            expect(el.getAttribute("aria-checked")).toBe("false");
        }
        expect(screen.queryByTestId("grid")).toBeNull();
    });

    it("押すと選ばれ、その色の枚数だけグリッドに渡る", () => {
        render(<ColorJourney />);
        fireEvent.click(screen.getByRole("switch", { name: /青/ }));
        expect(screen.getByRole("switch", { name: /青/ }).getAttribute("aria-checked")).toBe("true");
        expect(screen.getByTestId("grid").getAttribute("data-count")).toBe("3");
    });

    /** 足すだけのチップは、既に選んでいる色を押しても無反応になる（タグ入力で踏んだ形） */
    it("押し直すと外れ、グリッドも消える", () => {
        render(<ColorJourney />);
        const blue = screen.getByRole("switch", { name: /青/ });
        fireEvent.click(blue);
        expect(screen.getByTestId("grid")).toBeTruthy();
        fireEvent.click(blue);
        expect(screen.getByRole("switch", { name: /青/ }).getAttribute("aria-checked")).toBe("false");
        expect(screen.queryByTestId("grid"), "外したのにグリッドが残っている").toBeNull();
    });

    it("別の色を押すと、そちらに移る（2つ同時に光らない）", () => {
        render(<ColorJourney />);
        fireEvent.click(screen.getByRole("switch", { name: /青/ }));
        fireEvent.click(screen.getByRole("switch", { name: /黒/ }));
        expect(screen.getByRole("switch", { name: /青/ }).getAttribute("aria-checked")).toBe("false");
        expect(screen.getByRole("switch", { name: /黒/ }).getAttribute("aria-checked")).toBe("true");
        expect(screen.getByTestId("grid").getAttribute("data-count")).toBe("2");
    });

    it("チップに枚数が出る", () => {
        render(<ColorJourney />);
        expect(screen.getByRole("switch", { name: "青 (3)" })).toBeTruthy();
        expect(screen.getByRole("switch", { name: "黒 (2)" })).toBeTruthy();
    });
});

describe("チップの並び", () => {
    it("枚数順ではなく COLOR_BUCKETS の順（写真が増えても入れ替わらない）", () => {
        photos = [
            photo("k1", "#000000"), photo("k2", "#111111"), photo("k3", "#0a0a0a"),
            photo("b1", "#0000ff"), photo("b2", "#0000ee"),
        ];
        render(<ColorJourney />);
        // 青は2枚・黒は3枚だが、表の順（青が先）で並ぶ
        const labels = screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label"));
        expect(labels).toEqual(["青 (2)", "黒 (3)"]);
    });
});

describe("一覧が入れ替わったとき", () => {
    /**
     * `usePhotos()` はビルド時の断面から始まり、API の一覧で置き換わる。
     * **選んだ色が置き換わった一覧に無いことがある**ので、掴んだままにしない。
     */
    it("選んだ色が消えたら、グリッドも消える（枠だけ残さない）", () => {
        photos = [photo("a", "#0000ff"), photo("b", "#0000ee"), photo("c", "#000000"), photo("d", "#111111")];
        const { rerender } = render(<ColorJourney />);
        fireEvent.click(screen.getByRole("switch", { name: /青/ }));
        expect(screen.getByTestId("grid").getAttribute("data-count")).toBe("2");

        // 青が1枚に減った＝最小枚数を割ってチップごと消える
        photos = [photo("a", "#0000ff"), photo("c", "#000000"), photo("d", "#111111")];
        rerender(<ColorJourney />);

        expect(screen.queryByRole("switch", { name: /青/ }), "消えた色のチップが残っている").toBeNull();
        expect(screen.queryByTestId("grid"), "チップは消えたのにグリッドが残っている").toBeNull();
    });

    it("色が全部消えたら、部品ごと消える", () => {
        photos = [photo("a", "#0000ff"), photo("b", "#0000ee")];
        const { container, rerender } = render(<ColorJourney />);
        expect(container.firstChild).not.toBeNull();
        photos = [photo("a"), photo("b")];
        rerender(<ColorJourney />);
        expect(container.firstChild).toBeNull();
    });
});
