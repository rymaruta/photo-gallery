import { describe, it, expect } from "vitest";
import { stripPrivateFields } from "../server/photos";
import type { Photo } from "../data/photos";

// **静的ページに焼く前のふるい。**
//
// `scripts/sync-photos-from-ddb.js` の `PRIVATE_FIELDS` と対で、コメントも
// 「古い photos.json が残っていても漏れないように」と書いてある砦だが、
// **1本もテストが無かった**——`srcOriginal`（GPS 入り原本の URL）を
// 名簿から外しても全件緑だった。
//
// `staticStale`（静的ページの掃除が届いていないという内部の印）も落とす。
describe("静的ページに渡す前に落とす項目", () => {
    const photo = {
        id: "p1", src: "https://cdn/x.jpg", title: "あ",
        srcOriginal: "https://cdn/x_orig.jpg", key: "uploads/u/x.jpg", staticStale: true,
    } as unknown as Photo;

    it.each(["srcOriginal", "key", "staticStale"])("%s は渡さない", (field) => {
        const [out] = stripPrivateFields([photo]) as unknown as Array<Record<string, unknown>>;
        expect(out[field], `${field} が静的ページに焼かれる`).toBeUndefined();
    });

    it("表に出す項目は落とさない", () => {
        const [out] = stripPrivateFields([photo]) as unknown as Array<Record<string, unknown>>;
        expect(out.id).toBe("p1");
        expect(out.src).toBe("https://cdn/x.jpg");
        expect(out.title).toBe("あ");
    });

    it("元の配列を書き換えない（コピーを返す）", () => {
        stripPrivateFields([photo]);
        expect((photo as unknown as Record<string, unknown>).srcOriginal,
            "呼び出し元の項目を壊している").toBe("https://cdn/x_orig.jpg");
    });
});
