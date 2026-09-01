import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// アップロード経路の「配線」に関する不変条件。
//
// ここで起きたバグはロジックの誤りではなく、画面ごとに違う関数を呼んでいた
// ことが原因だった。個々の関数のテストでは捕まらないので、ソースを直接見て
// 「どの画面もこの経路を通る」ことを固定する。
//
//  1. ストーリー投稿だけ toUploadSafeFile を通っておらず、compressImage が
//     素通しで返した GPS 入りの原本が公開されていた。
//  2. 管理者だけ管理APIに送っていて、published を無視されるため
//     「下書き保存」が即公開になっていた（アイコンの経路は管理APIに無く404）。

const root = path.join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");

/** コメントを落としたソース。「なぜ直したか」を書いた説明文に反応しないため */
const readCode = (rel: string) =>
    read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 画像をユーザーの端末から S3 に上げる画面 */
const UPLOAD_SCREENS = [
    "app/user/upload/page.tsx",
    "app/user/profile/page.tsx",
    "app/components/stories/StoriesBar.tsx",
];

describe("アップロード画面は必ず toUploadSafeFile を通す", () => {
    it.each(UPLOAD_SCREENS)("%s は toUploadSafeFile を使う", (file) => {
        expect(read(file)).toContain("toUploadSafeFile");
    });

    it.each(UPLOAD_SCREENS)("%s は compressImage / stripJpegExif を直接呼ばない", (file) => {
        // どちらも「消せなかったら元のファイルをそのまま返す」経路を持つ。
        // 直接使うと EXIF（GPS）が残ったまま公開される。
        const src = readCode(file);
        expect(src).not.toMatch(/\bcompressImage\b/);
        expect(src).not.toMatch(/\bstripJpegExif\b/);
    });
});

describe("写真・アイコンの保存はユーザーAPIを通す", () => {
    it("アップロード画面は管理APIに切り替えない", () => {
        // 管理APIの savePhoto は published を見ずに常に true で保存し、
        // 撮影日・サムネURL・代表色・ぼかしも受け取らない。
        // アイコンの presigned URL に至っては経路そのものが無い。
        const src = readCode("app/user/upload/page.tsx");
        expect(src).not.toMatch(/isAdminUser\s*\?\s*authenticatedFetch/);
        expect(src).not.toContain("authenticatedFetch");
    });
});
