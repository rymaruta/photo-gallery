import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GalleryGrid from "../GalleryGrid";
import { GRID_SIZES_5XL, GRID_SIZES_6XL, GRID_SIZES_SEARCH, MOSAIC_HERO_SIZES, MOSAIC_PAIR_SIZES } from "../gridSizes";
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
const ROOT_PX = 16; // `sizes` の rem は**ブラウザの既定**で解かれる（実測）

function resolveSizes(sizes: string, viewport: number): number | null {
    const unit = (n: string, u: string) =>
        u === "vw" ? (parseFloat(n) / 100) * viewport : u === "rem" ? parseFloat(n) * ROOT_PX : parseFloat(n);
    const len = (raw: string): number | null => {
        const s = raw.trim();
        const calc = s.match(/^calc\(\s*([\d.]+)(vw|rem|px)\s*-\s*([\d.]+)(vw|rem|px)\s*\)$/);
        if (calc) return unit(calc[1], calc[2]) - unit(calc[3], calc[4]);
        const one = s.match(/^([\d.]+)(vw|rem|px)$/);
        return one ? unit(one[1], one[2]) : null;
    };
    for (const part of sizes.split(",")) {
        const t = part.trim();
        const m = t.match(/^\(max-width:\s*([\d.]+)(px|rem)\)\s+(.+)$/);
        if (!m) return len(t);              // 条件なし＝最後の受け皿
        if (viewport <= unit(m[1], m[2])) return len(m[3]);
    }
    return null;
}

/**
 * Chromium で実測した箱の幅（画面幅 → px）。**ブラウザの既定フォントは 16px。**
 *
 * このサイトは `@media (max-width:639px)` で `html{font-size:14px}` を当てている
 * ので、**640px 未満は root が 14px**（余白14・隙間3.5）。実測 179.25 は
 * `(390 - 28 - 3.5) / 2` と一致する。取り直すときは `out/` を配って
 * `img.getBoundingClientRect().width` を読むこと。
 */
const MEASURED_5XL: Array<[number, number]> = [
    [320, 144], [390, 179], [640, 193], [641, 194], [768, 231], [1024, 236], [1280, 236], [1536, 236],
];
const MEASURED_6XL: Array<[number, number]> = [
    [320, 144], [390, 179], [640, 199], [641, 199], [768, 241], [1024, 244], [1280, 276], [1536, 276],
];
/**
 * 「さがす」（`/search`）。**≥1024px で左に絞り込みの柱（248px）が入り**、
 * 容器の上限が `max-w-6xl`（72rem）になる。1023px までは `max-w-5xl` と同じ。
 * 列は **PC でも3列**（柱を置いて4列にすると 1024px で 165.5px ＝ スマホより
 * 小さくなる）。Chromium で `out/` を配って実測（2026-09-22）。
 */
const MEASURED_SEARCH: Array<[number, number]> = [
    [320, 144], [390, 179], [640, 193], [641, 194], [768, 231],
    [1024, 223], [1151, 265], [1152, 265], [1280, 265], [1536, 265], [1920, 265],
];

/**
 * ホームの写真の並び（`HomeMosaic`）。大きい1枚と2枚の段の1枚。Chromium で `next dev` を
 * 配って `a[data-photo-id]` の幅を読んだ（2026-09-29）。532〜639px は `max-w-xl`（504px）
 * ＋左右 14px の 532px で頭打ちになる（最初の式は `100vw` と申告していて、600px で 13% 大きかった）
 */
const MEASURED_MOSAIC_HERO: Array<[number, number]> = [
    [320, 320], [390, 390], [531, 531], [532, 532], [600, 532], [639, 532],
    [640, 576], [768, 576], [1023, 576], [1024, 640], [1280, 640], [1536, 640],
];
const MEASURED_MOSAIC_PAIR: Array<[number, number]> = [
    [320, 158], [390, 193], [531, 263.5], [532, 264], [600, 264], [639, 264],
    [640, 286], [768, 286], [1023, 286], [1024, 318], [1280, 318], [1536, 318],
];

const TOLERANCE = 0.02; // 実測との差は2%まで（式を実測に合わせたので絞れる）

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

    it.each(MEASURED_SEARCH)("さがす（柱つき）: 画面幅 %ipx で実測 %ipx に合う", (vw, actual) => {
        const declared = resolveSizes(GRID_SIZES_SEARCH, vw);
        expect(declared).not.toBeNull();
        expect(Math.abs(declared! - actual) / actual).toBeLessThanOrEqual(TOLERANCE);
    });

    it.each(MEASURED_MOSAIC_HERO)("ホームの大きい1枚: 画面幅 %ipx で実測 %ipx に合う", (vw, actual) => {
        const declared = resolveSizes(MOSAIC_HERO_SIZES, vw);
        expect(declared).not.toBeNull();
        expect(Math.abs(declared! - actual) / actual).toBeLessThanOrEqual(TOLERANCE);
    });

    it.each(MEASURED_MOSAIC_PAIR)("ホームの2枚の段: 画面幅 %ipx で実測 %ipx に合う", (vw, actual) => {
        const declared = resolveSizes(MOSAIC_PAIR_SIZES, vw);
        expect(declared).not.toBeNull();
        expect(Math.abs(declared! - actual) / actual).toBeLessThanOrEqual(TOLERANCE);
    });

    /**
     * **柱を置いたのに `sizes` を据え置く**のがいちばん起きやすい間違い
     * （容器と列数だけ直して申告を忘れる）。その形を通すと落ちること。
     */
    it("柱のぶんを引いていない式は、PC の幅で落ちる（判定の自己確認）", () => {
        const bad = MEASURED_SEARCH.filter(([vw]) => vw >= 1024).filter(([vw, actual]) => {
            const d = resolveSizes(GRID_SIZES_5XL, vw);   // 柱が無い前提の式
            return d === null || Math.abs(d - actual) / actual > TOLERANCE;
        });
        expect(bad.length, "柱の有無で申告が変わらない＝この判定は空回りしている")
            .toBe(MEASURED_SEARCH.filter(([vw]) => vw >= 1024).length);
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
    it.each([["5xl", GRID_SIZES_5XL], ["6xl", GRID_SIZES_6XL], ["さがす", GRID_SIZES_SEARCH], ["ホームの大きい1枚", MOSAIC_HERO_SIZES], ["ホームの2枚の段", MOSAIC_PAIR_SIZES]])("%s: 最後の受け皿は固定px（vw ではない）", (_n, sizes) => {
        const last = sizes.split(",").pop()!.trim();
        // 固定幅の計算（rem と px だけの calc）も可。vw を含むものは不可
        expect(last).toMatch(/^([\d.]+(px|rem)|calc\(\s*[\d.]+(px|rem)\s*-\s*[\d.]+(px|rem)\s*\))$/);
    });

    // **境界は Tailwind に合わせて手前で切る。** `sm:` は 640px **から**効くのに
    // `(max-width:640px)` も 640 を含むので、ちょうど 640px で食い違っていた。
    it.each([["5xl", GRID_SIZES_5XL], ["6xl", GRID_SIZES_6XL], ["さがす", GRID_SIZES_SEARCH], ["ホームの大きい1枚", MOSAIC_HERO_SIZES], ["ホームの2枚の段", MOSAIC_PAIR_SIZES]])("%s: 境界に 640px / 1024px を素で使わない", (_n, sizes) => {
        expect(sizes).not.toMatch(/max-width:\s*(640|768|1024|1152)(px|rem)/);
        expect(sizes).not.toMatch(/max-width:\s*(40|48|64|72)rem/);
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
    // **`<source>` は AVIF と WebP の2本ある。** 片方だけ見ていると、もう片方が
    // `sizes` を失っても緑になる（WebP しか出ない端末で効かなくなる）。
    it("渡した max-w-5xl の式が、全部の <source> に出る", () => {
        const { container } = render(<GalleryGrid photos={[photo("a")]} locale="ja" sizes={GRID_SIZES_5XL} />);
        const all = Array.from(container.querySelectorAll("source"));
        expect(all.length).toBeGreaterThanOrEqual(2);
        expect(all.map((s) => s.getAttribute("sizes"))).toEqual(all.map(() => GRID_SIZES_5XL));
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
        const all = Array.from(container.querySelectorAll("source"));
        expect(all.length).toBeGreaterThanOrEqual(2);
        expect(all.map((s) => s.getAttribute("sizes"))).toEqual(all.map(() => GRID_SIZES_6XL));
    });

    it("写真が出ている（描画そのものが壊れていない）", () => {
        render(<GalleryGrid photos={[photo("c")]} locale="ja" sizes={GRID_SIZES_5XL} />);
        expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
    });
});
