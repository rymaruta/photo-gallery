import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { HIGHLIGHTS_PER_USER, STORIES_PER_HIGHLIGHT, HIGHLIGHT_TITLE_MAX, highlightRejection } from "../../lib/highlights";

// **ハイライトの上限が2か所にある。** クライアントから `api-user` は import
// できないので複製する。ずれると、画面が「あと1つ入る」と見せてサーバーが
// 断る（`storyVisibilityParity` と同じ手で数値そのものを突き合わせる）。
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
    it("画面の判定はサーバーと同じ2条件（印がある・全員に公開）", () => {
        const base = { id: "s", src: "x", userId: "u", createdAt: "2026-07-04T00:00:00Z", expiresAt: "2026-07-05T00:00:00Z" };
        expect(highlightRejection({ ...base, archive: true }, true)).toBeNull();
        expect(highlightRejection({ ...base, archive: true, visibility: "public" }, true)).toBeNull();
        expect(highlightRejection({ ...base }, true)).toMatch(/アーカイブ/);
        expect(highlightRejection({ ...base, archive: true, visibility: "followers" }, true)).toMatch(/フォロワー/);
        // サーバーは `archive !== true` と `storyVisibility(...) !== STORY_PUBLIC` で断る
        expect(server).toMatch(/row\.archive !== true/);
        expect(server).toMatch(/storyVisibility\(row\.visibility\) !== STORY_PUBLIC/);
    });
});
