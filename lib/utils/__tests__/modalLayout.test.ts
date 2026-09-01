import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvedCaptionMinHeight, captionFitsViewport, CAPTION_MIN_HEIGHT } from "../modalLayout";

// **横向きでキャプションの下部に指が届かなかった（TAP-7）。**
// 画像 300px + キャプション 200px の固定下限が外枠（95vh）を超えていた。
// 実測（修正前）: 667x375 で最後の行が画面外に118px、568x320 で169px。
//
// **モデルは実物に合わせる（訂正）。** 最初は「画像の下限 + キャプションの
// 下限 ≤ 95vh」で書いたが、実際に高さを決めているのは画像の**下限ではなく
// `60vh`**。相手を間違えると、条件を満たしているのに溢れる。
describe("キャプションの下限は、画像（60vh）と合わせて外枠に収まる", () => {
    // 横向きのスマホの高さ（320〜430）と縦向き（568〜932）、極端に低い画面
    it.each([200, 250, 320, 360, 375, 390, 414, 430, 568, 667, 736, 844, 932])(
        "高さ %ipx で収まる", (vh) => {
            expect(captionFitsViewport(vh), `60vh + キャプション下限が ${vh}px の枠を超えている`).toBe(true);
        });

    // **固定 200px に戻すと落ちること**を同じ式で確かめる（この条件が
    // 「たまたま満たされている」のではないことを示す）
    it("固定 200px は低い画面で 60vh と両立しない", () => {
        const fixedFits = (vh: number) => vh * 0.6 + 200 <= vh * 0.95;
        expect(fixedFits(375), "修正前の値で 375px に収まってしまっている").toBe(false);
        expect(fixedFits(320)).toBe(false);
        expect(fixedFits(667)).toBe(true);   // 縦向きでは問題が出なかった理由
    });

    it("高さ 667px 以上では今までと同じ下限（見た目を変えない）", () => {
        expect(resolvedCaptionMinHeight(667)).toBe(200);
        expect(resolvedCaptionMinHeight(932)).toBe(200);
    });

    it("低い画面では下限も小さくなる", () => {
        expect(resolvedCaptionMinHeight(375)).toBeCloseTo(112.5);
        expect(resolvedCaptionMinHeight(320)).toBeCloseTo(96);
    });
});

// **定数を作っただけでは、コンポーネントが使っているとは限らない。**
// レビューで実証された穴: `minHeight` を修正前の固定値に戻しても
// **2,364件すべて緑**だった（このモジュールのテストは定数と算術しか
// 見ておらず、参照側を誰も見ていなかった）。jsdom はレイアウトを計算
// しないので、せめて「コードが定数を参照していること」を見る。
// **コメントを数えないように、コメントは落としてから見る**——同じ回に
// 書いた safe-area のテストは、実装ではなく自分のコメントを検証していた。
describe("モーダルが定数を参照している", () => {
    const codeOf = (rel: string) =>
        readFileSync(join(process.cwd(), rel), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, " ")
            .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

    it("キャプションは CAPTION_MIN_HEIGHT を使う（固定 px に戻っていない）", () => {
        const code = codeOf("app/components/GalleryModal/ModalCaption.tsx");
        expect(code, "定数を参照していない").toContain("minHeight: CAPTION_MIN_HEIGHT");
        expect(code, "固定 px に戻っている").not.toMatch(/minHeight:\s*"200px"/);
    });

    it("画像エリアは下限を持たない（60vh が決める）", () => {
        const code = codeOf("app/components/GalleryModal/index.tsx");
        expect(code, "効かない下限が戻っている").not.toMatch(/minHeight:\s*"300px"/);
        // **`dvh` で測る。** 枠は実際の表示領域（`h-full`）なので、中身が
        // `vh` だとツールバーのぶんずれて `overflow-hidden` に切られる
        expect(code, "vh のままだとツールバーの分だけ切られる").toContain('height: "60dvh"');
    });

    // **枠（95dvh）を基準にも縛る。** `100dvh - 60dvh - 40px` だけだと、
    // 画像の 60dvh と合わせて `100dvh - 40px` になり、枠を超えた分が
    // `overflow-hidden` で切られる。実測（説明40段落）:
    //   修正前 1280x900 で 5px / 1920x1400 で 30px / 2560x2000 で 60px 切られ、
    //          高さ1520px付近から共有ボタンの行に掛かる
    //   修正後 どの高さでも切られ量 0
    it("キャプションの上限は枠（35dvh）にも縛られる", () => {
        const code = codeOf("app/components/GalleryModal/ModalCaption.tsx");
        expect(code, "大きい画面で枠からはみ出して切られる").toContain("35dvh");
        expect(code).toMatch(/maxHeight:\s*"min\(/);
    });

    it("CSS の式と定数が一致している", () => {
        expect(CAPTION_MIN_HEIGHT).toBe("min(200px, 30dvh)");
    });
});
