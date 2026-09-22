import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { HIGHLIGHTS_PER_USER, STORIES_PER_HIGHLIGHT, HIGHLIGHT_TITLE_MAX, highlightRejection } from "../../lib/highlights";

// **ハイライトの上限が2か所にある。** クライアントから `api-user` は import
// できないので複製する。ずれると、画面が「あと1つ入る」と見せてサーバーが
// 断る（数値そのものを突き合わせる）。
const root = join(__dirname, "..", "..");
const server = readFileSync(join(root, "api-user/src/highlights.ts"), "utf8");

const constant = (name: string) => {
    const m = server.match(new RegExp(`export const ${name} = (\\d+);`));
    expect(m, `サーバー側の ${name} を読み取れない（形が変わった？）`).toBeTruthy();
    return Number(m![1]);
};

describe("ハイライト: サーバーと画面で同じ上限", () => {
    it("個数・枚数・題の長さ", () => {
        expect(constant("HIGHLIGHTS_PER_USER")).toBe(HIGHLIGHTS_PER_USER);
        expect(constant("STORIES_PER_HIGHLIGHT")).toBe(STORIES_PER_HIGHLIGHT);
        expect(constant("HIGHLIGHT_TITLE_MAX")).toBe(HIGHLIGHT_TITLE_MAX);
    });

    // 画面の「押せない理由」はサーバーの `checkStories` と同じ向き
    it("画面の判定はサーバーと同じ（印がある）", () => {
        const base = { id: "s", src: "x", userId: "u", createdAt: "2026-07-04T00:00:00Z", expiresAt: "2026-07-05T00:00:00Z" };
        expect(highlightRejection({ ...base, archive: true }, true)).toBeNull();
        expect(highlightRejection({ ...base }, true)).toMatch(/アーカイブ/);
        // サーバーは `archive !== true` で断る
        expect(server).toMatch(/row\.archive !== true/);
    });

    // 🔴 **公開範囲では断らない。** ハイライトもストーリーもフォロワーだけが
    // 見るので、見せる相手が同じ（2026-09-22・owner の判断）。ここを戻すと、
    // 公開範囲があった頃に投稿したアーカイブが永久に入れられなくなる
    it("死んだ `visibility` の列を、画面もサーバーも見ない", () => {
        const base = { id: "s", src: "x", userId: "u", createdAt: "2026-07-04T00:00:00Z", expiresAt: "2026-07-05T00:00:00Z", archive: true };
        // 型から消してあるので、古い行の形は明示して渡す
        expect(highlightRejection({ ...base, visibility: "followers" } as typeof base, true)).toBeNull();
        expect(server, "サーバーが公開範囲を読み直している").not.toMatch(/visibility/);
    });
});
