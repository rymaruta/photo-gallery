import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GalleryGrid from "../GalleryGrid";
import { GRID_SIZES_5XL, GRID_SIZES_6XL } from "../gridSizes";
import type { Photo } from "@/lib/data/photos";

/**
 * **`sizes` は「実際に描かれる幅」を申告する。**
 *
 * ずれるとブラウザが選ぶ候補が変わる。以前は `GalleryGrid` が
 * `"(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"` を決め打ちして
 * いて、**256px の候補が一度も選ばれなかった**（実測・トップページ30枚）:
 *
 *     画面 1280px DPR1  箱 236px  256w 0件 / 512w 30件   ← 236px の箱に 512px
 *     ちょうど 640px    箱 193px  256w 0件 / 512w 30件
 *
 * 直したあと:
 *
 *     画面 1280px DPR1  箱 236px  256w 30件 / 512w 0件
 *     画面 1280px DPR2  箱 236px  256w  0件 / 512w 30件  ← DPR2 は 512 が正しいので不変
 *
 * jsdom はレイアウトを計算しないので、**Chromium で測った箱の幅を表にして**
 * 式がそれと合うかを見る。表を取り直すときは、`out/` を配って
 * `img.getBoundingClientRect().width` を画面幅ごとに読むこと。
 */

/** `sizes` の式を、指定の画面幅で解く（ブラウザがやることの最小版） */
function resolveSizes(sizes: string, viewport: number): number | null {
    const len = (raw: string): number | null => {
        const s = raw.trim();
        const calc = s.match(/^calc\(\s*([\d.]+)vw\s*-\s*([\d.]+)px\s*\)$/);
        if (calc) return (parseFloat(calc[1]) / 100) * viewport - parseFloat(calc[2]);
        const vw = s.match(/^([\d.]+)vw$/);
        if (vw) return (parseFloat(vw[1]) / 100) * viewport;
        const px = s.match(/^([\d.]+)px$/);
        return px ? parseFloat(px[1]) : null;
    };
    for (const part of sizes.split(",")) {
        const t = part.trim();
        const m = t.match(/^\(max-width:\s*([\d.]+)px\)\s+(.+)$/);
        if (!m) return len(t);              // 条件なし＝最後の受け皿
        if (viewport <= parseFloat(m[1])) return len(m[2]);
    }
    return null;
}

/** Chromium で実測した箱の幅（画面幅 → px） */
const MEASURED_5XL: Array<[number, number]> = [
    [320, 144], [390, 179], [640, 193], [641, 194], [768, 231], [1024, 236], [1280, 236], [1536, 236],
];
const MEASURED_6XL: Array<[number, number]> = [
    [320, 144], [390, 179], [640, 199], [641, 199], [768, 241], [1024, 244], [1280, 276], [1536, 276],
];

const TOLERANCE = 0.05; // 実測との差は5%まで

describe("グリッドの sizes が実際の幅と合っている", () => {
    it.each(MEASURED_5XL)("max-w-5xl の画面: 画面幅 %ipx で実測 %ipx に合う", (vw, actual) => {
        const declared = resolveSizes(GRID_SIZES_5XL, vw);
        expect(declared).not.toBeNull();
        expect(Math.abs(declared! - actual) / actual).toBeLessThanOrEqual(TOLERANCE);
    });

    it.each(MEASURED_6XL)("max-w-6xl の画面: 画面幅 %ipx で実測 %ipx に合う", (vw, actual) => {
        const declared = resolveSizes(GRID_SIZES_6XL, vw);
        expect(declared).not.toBeNull();
        expect(Math.abs(declared! - actual) / actual).toBeLessThanOrEqual(TOLERANCE);
    });

    // **この判定が空回りしていないこと。** 直す前の式を通すと落ちるはず。
    //
    // 旧式は容器の余白も段の隙間も無視していたので、**どの画面幅でもずれている**
    // （320px でも 160px と申告して実際は 144px＝11%）。ただし**選ばれる候補が
    // 実際に変わったのは** 256/512 の境目をまたぐ 640 / 1024 / 1280 / 1536 の
    // ところ（実測: そこだけ 512w → 256w になった）。
    it("直す前の式は全部の幅で落ちる（判定の自己確認）", () => {
        const OLD = "(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw";
        const bad = MEASURED_5XL.filter(([vw, actual]) => {
            const d = resolveSizes(OLD, vw);
            return d === null || Math.abs(d - actual) / actual > TOLERANCE;
        });
        expect(bad.map(([vw]) => vw)).toEqual(MEASURED_5XL.map(([vw]) => vw));
        // いちばんひどいのは画面が広いとき（容器が頭打ちなのに vw で伸び続ける）
        expect(resolveSizes(OLD, 1536)! / 236).toBeGreaterThan(1.5);
    });

    // **容器に上限があるので、いちばん広いときは vw で申告してはいけない。**
    it.each([["5xl", GRID_SIZES_5XL], ["6xl", GRID_SIZES_6XL]])("%s: 最後の受け皿は固定px（vw ではない）", (_n, sizes) => {
        const last = sizes.split(",").pop()!.trim();
        expect(last).toMatch(/^\d+px$/);
    });

    // **境界は Tailwind に合わせて手前で切る。** `sm:` は 640px **から**効くのに
    // `(max-width:640px)` も 640 を含むので、ちょうど 640px で食い違っていた。
    it.each([["5xl", GRID_SIZES_5XL], ["6xl", GRID_SIZES_6XL]])("%s: 境界に 640px / 1024px を素で使わない", (_n, sizes) => {
        expect(sizes).not.toMatch(/max-width:\s*(640|768|1024|1152)px/);
    });
});

/** **派生を持たせる。** 無いと `Thumb` は `<picture>` を出さないので `sizes` も出ない */
const photo = (id: string): Photo => {
    const b = `https://journey-photo.com/uploads/${id}`;
    return {
        id, src: `${b}.jpg`, title: "題", description: "", category: "landscape", tags: [], published: true,
        thumbSrc: `${b}_thumb.webp`, thumbSm: `${b}_thumb_sm.webp`,
        thumbAvif: `${b}_thumb.avif`, thumbSmAvif: `${b}_thumb_sm.avif`,
    } as unknown as Photo;
};

describe("配線", () => {
    it("渡した max-w-5xl の式がそのまま出る", () => {
        const { container } = render(<GalleryGrid photos={[photo("a")]} locale="ja" sizes={GRID_SIZES_5XL} />);
        const src = container.querySelector("source[sizes]");
        expect(src?.getAttribute("sizes") ?? container.querySelector("img")?.getAttribute("sizes")).toBe(GRID_SIZES_5XL);
    });

    /**
     * **`sizes` は必須。既定値を置かない。**
     *
     * 置いていた頃、「集約ページが `GRID_SIZES_6XL` を渡すのをやめる」変異が
     * テストを**素通りした**——容器が広いのに狭い方の式が黙って使われ、
     * 箱 276px に 236px と申告して**小さすぎる候補を選ぶ**（ぼやける）。
     *
     * ここは `tsc` が守る。任意に戻すと「使われていない
     * `@ts-expect-error`」で**型検査が落ちる**（`npm run verify` が拾う）。
     */
    it("sizes を省くと型検査が落ちる（既定値を置かない）", () => {
        const omitted = () => (
            // @ts-expect-error sizes は必須（省略できてはいけない）
            <GalleryGrid photos={[photo("z")]} locale="ja" />
        );
        expect(typeof omitted).toBe("function");
    });

    it("渡された式をそのまま出す", () => {
        const { container } = render(<GalleryGrid photos={[photo("b")]} locale="ja" sizes={GRID_SIZES_6XL} />);
        const src = container.querySelector("source[sizes]");
        expect(src?.getAttribute("sizes") ?? container.querySelector("img")?.getAttribute("sizes")).toBe(GRID_SIZES_6XL);
    });

    it("写真が出ている（描画そのものが壊れていない）", () => {
        render(<GalleryGrid photos={[photo("c")]} locale="ja" sizes={GRID_SIZES_5XL} />);
        expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
    });
});
