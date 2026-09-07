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

/**
 * **禁止ではなく許可で見る。** 「薄いものを弾く」形にしていたら、
 * `text-white/5`（単桁）・`text-white/[0.3]`（任意値）・`text-gray-600`
 * （別の色系統へ逃がす）が全部素通りした——**いちばん捕まえたい方向**が
 * 抜けていた。黒文字（白地）も見ていなかった。
 *
 * 通すのは、黒地／白地で 4.5:1 に届くと分かっているものだけ:
 *   `text-white`（21:1）・`text-white/46` 以上（4.58:1〜）
 *   `text-black`（21:1）・`text-black/55` 以上（4.76:1〜）
 */
const COLOR_TOKEN = /(?:^|[\s"'`{])((?:hover:|focus:|group-hover:|disabled:|placeholder:|active:)?)text-(white|black|[a-z]+-\d{2,3})(\/(\[[^\]]*\]|\d{1,3}))?/g;

function unreadableTokens(cls: string): string[] {
    const bad: string[] = [];
    for (const m of cls.matchAll(COLOR_TOKEN)) {
        const [, prefix, hue, , amount] = m;
        // hover / focus は「濃くなる側」だが、その状態でも基準は要る。
        // ただし土台が通っていれば hover を見る意味は薄いので、ここでは見ない
        if (prefix) continue;
        if (hue !== "white" && hue !== "black") { bad.push(m[0].trim()); continue; }   // 別の色系統へ逃がした
        if (amount === undefined) continue;                                            // 素の white/black は 21:1
        const n = Number(amount);
        if (!Number.isFinite(n)) { bad.push(m[0].trim()); continue; }                   // /[0.3] のような任意値
        const min = hue === "white" ? 46 : 55;
        if (n < min) bad.push(m[0].trim());
    }
    return bad;
}

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
        expect(unreadableTokens(cls), `4.5:1 に届かない濃さ: ${cls.slice(0, 110)}`).toEqual([]);
    });

    // 目印の文字列だけを見ていると、その行から色の指定が消えたときに
    // 「薄くない」で通ってしまう。濃さの指定が残っていることも見る
    it.each(GUARDED)("%s の「%s」は濃さの指定を持っている", (file, needle) => {
        const { src, i } = findLine(file)(needle);
        const cls = classNameFor(src, i);
        expect(/text-white(\/\d+)?\b|text-\[#|text-gray|text-black/.test(cls),
            `色の指定が見当たらない（既定の色に落ちていないか）: ${src[i]?.trim().slice(0, 80)}`).toBe(true);
    });

    // 判定そのものの自己確認。**「薄いものを弾く」形で素通りしたもの**を並べる
    it("判定が抜け道を塞いでいる", () => {
        // 通す
        for (const ok of ['text-white/50', 'text-white/46', 'text-white', 'text-black/55', 'text-black',
                          'text-[11px] ${active ? "text-black/55" : "text-white/50"}']) {
            expect(unreadableTokens(ok), ok).toEqual([]);
        }
        // 弾く（下の3つは「薄いものを弾く」形では全部素通りしていた）
        for (const ng of ['text-white/40', 'text-white/45', 'text-white/5', 'text-white/[0.3]',
                          'text-gray-600', 'text-black/50', 'text-black/10']) {
            expect(unreadableTokens(ng).length, ng).toBeGreaterThan(0);
        }
        // hover / placeholder は土台と別。ここでは見ない
        expect(unreadableTokens('text-white/50 hover:text-white/40')).toEqual([]);
        expect(unreadableTokens('text-white placeholder:text-white/35')).toEqual([]);
    });
});
