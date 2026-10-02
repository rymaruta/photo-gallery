import { describe, it, expect } from "vitest";
import { resolveShortPhotoId, shortPhotoId } from "../shortPhotoLink";

const ids = [
    "a0e0e987-4686-437a-a5fd-b6eaa2debd84",
    "29de9197-5d15-490e-83ae-491e7386bb34",
    "29de9197-ffff-490e-83ae-491e7386bb34",
];

describe("短縮リンク /?p=<先頭8文字>", () => {
    it("ID の先頭8文字を小文字で作る", () => {
        expect(shortPhotoId("A0E0E987-4686-437a-a5fd-b6eaa2debd84")).toBe("a0e0e987");
    });

    it("1枚に決まれば、その写真", () => {
        expect(resolveShortPhotoId("a0e0e987", ids)).toEqual({ kind: "found", id: ids[0] });
        // 手で打ち直した大文字・前後の空白も同じ
        expect(resolveShortPhotoId(" A0E0E987 ", ids)).toEqual({ kind: "found", id: ids[0] });
    });

    it("同じ先頭が2枚あれば選ばない（別の写真を開かない）", () => {
        expect(resolveShortPhotoId("29de9197", ids)).toEqual({ kind: "ambiguous" });
    });

    it("一覧に無ければ none（まだ届いていない・消された）", () => {
        expect(resolveShortPhotoId("deadbeef", ids)).toEqual({ kind: "none" });
    });

    it("短縮の形でなければ触らない（空・長さ違い・16進以外）", () => {
        for (const v of [null, "", "a0e0e98", "a0e0e9870", "p1", "zzzzzzzz"]) {
            expect(resolveShortPhotoId(v, ids)).toEqual({ kind: "invalid" });
        }
    });
});
