import { describe, it, expect } from "vitest";
import { isValidYouTubeUrl } from "../photoUpdate";
import { isYouTubeMvUrl } from "../../../lib/utils/music";

/**
 * 写真の MV の YouTube リンク。サーバーは `isValidYouTubeUrl`、
 * 画面は `parseMusicEmbed` を使い回す。**同じ表を2つ持たない**ぶん、
 * 答えが一致することをここで確かめる。
 *
 * **`scripts/__tests__/limitParity.test.ts` から移した。**
 * あちらは `scripts/**` にあり、ルートの `tsconfig.json` の
 * `include`（すべての `.ts`）に入る。そこから `api-user/src/photoUpdate` を
 * import すると、**`exclude: [... "api-user"]` を貫通して**型検査に
 * api-user が引き込まれる——`aws-lambda` の型は `api-user/node_modules`
 * にしかないので、`npx tsc --noEmit` が
 *
 *     api-user/src/albums.ts(23,90): error TS2307: Cannot find module 'aws-lambda'
 *
 * ほか**19件**で落ちた（2026-09-13・CI run 4 が実際に赤くなった）。
 * `exclude` は「ルートの型検査は api-user を見ない」という意思表示なのに、
 * import はそれを素通りする。
 *
 * **ここ（`api-user/src/__tests__/`）なら同じ import が自然に書ける**
 * ——このディレクトリ自体が `exclude` の中で、`follow.test.ts` など既存の
 * テストも普通に `../follow` を import している。判定の中身は1行も
 * 変えていない（移しただけ）。
 */
describe("YouTube のリンクの判定", () => {
    it("サーバーと画面が同じ答えを出す", () => {
        const corpus = [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ",
            // 断るべきもの
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",  // https でない
            "https://vimeo.com/12345",
            "https://open.spotify.com/track/abc",
            "https://music.apple.com/jp/album/x/1",
            "abc",
            "",
            "   ",
            "https://www.youtube.com/watch?v=short",        // id が短い
            "https://www.youtube.com/watch",                // id が無い
            "https://evil.com/watch?v=dQw4w9WgXcQ",
        ];
        for (const u of corpus) {
            expect(isYouTubeMvUrl(u), `「${u}」で画面とサーバーの答えが違う`)
                .toBe(Boolean(isValidYouTubeUrl(u)));
        }
        // **corpus が両方の答えを含んでいること**（全部 false だと素通りする）
        expect(corpus.filter(isYouTubeMvUrl).length, "通す例が入っていない").toBeGreaterThan(0);
        expect(corpus.filter((u) => !isYouTubeMvUrl(u)).length, "断る例が入っていない").toBeGreaterThan(0);
    });
});
