import { describe, it, expect } from "vitest";
import { isValidYouTubeUrl } from "../photoUpdate";
import { isYouTubeMvUrl } from "../../../lib/utils/music";

/**
 * **画面が「送る前に断る」判定は、サーバーの断り方と同じでなければならない。**
 *
 * 狭すぎると**押せるのに必ず失敗する**（これが直した当の不具合）。
 * 広すぎると**正当な操作を止める**——台帳が何度も踏んでいる、より怖い方向。
 *
 * ⚠️ **この突き合わせを `scripts/__tests__/` に置いてはいけない。**
 * ルートの `tsconfig.json` は `exclude` に `api-user` を挙げているが、
 * **`exclude` は import で辿られたファイルを止められない**。あちらから
 * `api-user/src/photoUpdate` を import した版は `npx tsc --noEmit` が
 * **19件**のエラーを出し（`@types/aws-lambda` は api-user 側の
 * devDependencies にしかない）、`next build` が TypeScript の段階で止まった
 * ——**デプロイが落ちる**。`vitest` は型を見ないので全緑のまま気づけない。
 * api-user 側はルートの型検査の外なので、ここに置けば触らない。
 */
describe("YouTube のリンクの判定が、画面とサーバーで同じ", () => {
    const corpus = [
        // 通すべきもの
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ?t=30",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=10",
        // **前後の空白。** サーバーは `raw.trim()` するので、画面が trim を
        // やめると**画面だけが正当なリンクを断る**。corpus に無かったので
        // その変異が素通りしていた（レビューが実証）
        " https://youtu.be/dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ ",
        "\thttps://youtu.be/dQw4w9WgXcQ\n",
        // 断るべきもの
        "http://www.youtube.com/watch?v=dQw4w9WgXcQ",   // https でない
        "HTTPS://youtu.be/dQw4w9WgXcQ",                 // スキームの大文字
        "https://vimeo.com/12345",
        "https://open.spotify.com/track/abc",
        "https://music.apple.com/jp/album/x/1",
        "https://gaming.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com.evil.jp/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "abc",
        "",
        "   ",
        "https://www.youtube.com/watch?v=short",         // id が短い
        "https://www.youtube.com/watch",                 // id が無い
    ];

    it("corpus のどれでも同じ答えを出す", () => {
        for (const u of corpus) {
            expect(isYouTubeMvUrl(u), `「${u}」で画面とサーバーの答えが違う`)
                .toBe(Boolean(isValidYouTubeUrl(u)));
        }
    });

    // **corpus が両方の答えを含んでいること**（全部 false だと素通りする）
    it("通す例と断る例が両方入っている", () => {
        expect(corpus.filter(isYouTubeMvUrl).length, "通す例が入っていない").toBeGreaterThan(0);
        expect(corpus.filter((u) => !isYouTubeMvUrl(u)).length, "断る例が入っていない").toBeGreaterThan(0);
    });

    // 空白を落とす側が本当に効いていること（上の corpus の意図を名指しで固定）
    it("前後の空白があっても、両方が同じく通す", () => {
        const padded = "  https://youtu.be/dQw4w9WgXcQ  ";
        expect(isYouTubeMvUrl(padded), "画面が空白を落としていない").toBe(true);
        expect(Boolean(isValidYouTubeUrl(padded))).toBe(true);
    });

    /**
     * ⚠️ **500文字を超えると答えが割れる**（サーバーだけが `slice(0, 500)` する）。
     * 現実的な YouTube の URL では届かないが、**入力欄に上限が無かった**ので
     * 理屈上は作れた。曲のリンク欄は既に 500 なので、そちらに揃えた
     * （`app/photo/[id]/PhotoPageClient.tsx` の `maxLength`）。
     */
    it("500文字の上限は、画面の入力欄で縛る", async () => {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const src = readFileSync(join(__dirname, "..", "..", "..", "app", "photo", "[id]", "PhotoPageClient.tsx"), "utf8");
        const m = /placeholder=\{photoYtUrl[\s\S]{0,600}?maxLength=\{(\d+)\}/.exec(src);
        expect(m, "MV の入力欄の maxLength を読めていない").not.toBeNull();
        expect(Number(m![1]), "サーバーの切り詰め（500）と違う").toBe(500);
    });
});
