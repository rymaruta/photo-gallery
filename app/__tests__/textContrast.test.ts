import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **黒地に薄い白は読めない。** Chromium で全ページの文字を実測したところ、
// 半透明の文字が基準（WCAG AA・普通の文字で 4.5:1）を下回っていた:
//
//   text-white/30 → 2.46:1   text-white/35 → 3.01:1
//   text-white/40 → 3.66:1   text-white/45 → 4.41:1   text-white/50 → 5.28:1
//
// いちばん効いていたのは**新規登録のパスワード条件**（2.48:1）——読めないと
// アカウントが作れない文。ほかに写真ページの撮影情報のラベル（3.16:1）、
// フッターの著作権表示（2.48:1・全ページ）など。
//
// **測定の道具に穴があった**ことも記録する: Tailwind v4 は `oklab(… / 0.4)` を
// 出すので、`rgb()` の正規表現で読む実装は**半透明の文字を全部飛ばし、
// 「全ページ合格」という嘘の結果**を返していた。既知の下地2色に塗って
// 読み戻す形に直して初めて出た（測定スクリプトは scratchpad の `a11y/contrast.mjs`）。
//
// jsdom は CSS を評価しないので、ここでは**直した箇所が薄い指定に戻っていないか**
// だけを見る。全画面の実測はブラウザでしかできない。

const ROOT = join(__dirname, "..", "..");

/** 4.5:1 に届く最小の段階。これ未満は本文の文字に使わない */
const TOO_FAINT = /text-white\/(?:[0-3]\d|4[0-5])\b/;

/** その行が「読めないと困る文字」であるもの。目印の文字列で行を特定する */
const GUARDED: Array<[string, string, string]> = [
    ["app/signup/page.tsx", "英大文字・小文字・数字", "パスワードの条件（読めないと登録できない）"],
    ["app/signup/page.tsx", "写真のアップロードができるようになります", "新規登録の説明"],
    ["app/login/page.tsx", "写真をアップロードするにはログインが必要です", "ログインの説明"],
    ["app/login/page.tsx", "パスワードをお忘れですか", "パスワード再設定への導線"],
    ["app/components/Footer.tsx", "© Journey Photo", "全ページに出る著作権表示"],
    ["app/privacy/page.tsx", "最終更新日", "プライバシーポリシーの更新日"],
    // 子の <Link>（/70）を親と取り違えていたので、包む <p> を直接の目印にする
    ["app/components/CommentSection.tsx", '<p className="mb-4 text-xs', "コメントの案内"],
    ["app/map/page.tsx", "GPS 付きの写真をアップロード", "地図が空のときの案内"],
    // 画面に出る文字が変数で、目印にできないもの。コードの断片を目印にする
    ["app/components/FilterBar.tsx", "showCount ? <span", "絞り込みのチップの件数"],
    ["app/components/CollectionPageClient.tsx", "{r.count}", "関連する集約ページの件数"],
    ["app/photo/[id]/PhotoPageClient.tsx", "<dt ", "撮影情報のラベル（カメラ・レンズ…）"],
];

/** 目印の行を探す。**コメント行は数えない**（「最終更新日」は注意書きにも出てくる） */
function findLine(file: string): (needle: string) => { src: string[]; i: number } {
    const src = readFileSync(join(ROOT, file), "utf8").split("\n");
    return (needle: string) => {
        const i = src.findIndex((l) => l.includes(needle) && !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));
        return { src, i };
    };
}

/**
 * その文字を包む要素の色の指定。**まず同じ行を見る**——三項で書いてある場合
 * （`${active ? "…" : "text-white/50"}`）は className の頭だけを取ると
 * 色を取り逃がす。同じ行に無ければ、改行して書いてあるとみて上へたどる
 */
function classNameFor(src: string[], i: number): string {
    const hasColor = (l: string) => /text-white(\/\d+)?\b|text-black(\/\d+)?\b|text-\[#|text-gray/.test(l);
    if (i >= 0 && hasColor(src[i])) return src[i];
    for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        if (/className=/.test(src[j]) && hasColor(src[j])) return src[j];
        if (/className=/.test(src[j])) return src[j];   // 指定はあるが色が無い＝既定の色
    }
    return "";
}

describe("読めない濃さの文字に戻っていないか", () => {
    it.each(GUARDED)("%s の「%s」（%s）", (file, needle) => {
        const { src, i } = findLine(file)(needle);
        expect(i, `${file} に「${needle}」の行が無い`).toBeGreaterThanOrEqual(0);
        const cls = classNameFor(src, i);
        expect(TOO_FAINT.test(cls), `4.5:1 に届かない濃さ: ${cls.slice(0, 100)}`).toBe(false);
    });

    // 目印の文字列だけを見ていると、その行から色の指定が消えたときに
    // 「薄くない」で通ってしまう。濃さの指定が残っていることも見る
    it.each(GUARDED)("%s の「%s」は濃さの指定を持っている", (file, needle) => {
        const { src, i } = findLine(file)(needle);
        const cls = classNameFor(src, i);
        expect(/text-white(\/\d+)?\b|text-\[#|text-gray|text-black/.test(cls),
            `色の指定が見当たらない（既定の色に落ちていないか）: ${src[i]?.trim().slice(0, 80)}`).toBe(true);
    });

    // 上の正規表現が「薄い」を正しく捕まえることを確かめる（道具の自己確認）
    it("判定そのものが効いている", () => {
        expect(TOO_FAINT.test('className="text-white/40 text-sm"')).toBe(true);
        expect(TOO_FAINT.test('className="text-white/45"')).toBe(true);
        expect(TOO_FAINT.test('className="text-white/50"')).toBe(false);
        expect(TOO_FAINT.test('className="text-white/70"')).toBe(false);
        // hover: は据え置きでよい（濃くなる側）
        expect(TOO_FAINT.test('className="text-white/50 hover:text-white/40"'), "hover を拾っている").toBe(true);
    });
});
