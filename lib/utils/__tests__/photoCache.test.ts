import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dropCachedPhoto, PHOTO_CACHE_NAME } from "../photoCache";

/**
 * 写真の控えを画面側から捨てる口。
 *
 * これが効かないと、キャプティブポータルが返した HTML を「写真」として
 * 控えた端末が**永久に割れた画像のまま**になる（キャッシュ優先・寿命なし）。
 * 別オリジンの写真は応答が opaque で SW 側では弾けないので、**ここが
 * 唯一の回復路**。
 */

type FakeCache = { deleted: string[]; delete: (url: string) => Promise<boolean> };

function fakeCaches() {
    const caches_ = new Map<string, FakeCache>();
    const make = (): FakeCache => {
        const c: FakeCache = { deleted: [], delete: async (u) => { c.deleted.push(u); return true; } };
        return c;
    };
    const api = {
        opened: [] as string[],
        open: async (name: string) => {
            api.opened.push(name);
            if (!caches_.has(name)) caches_.set(name, make());
            return caches_.get(name)!;
        },
        get: (name: string) => caches_.get(name),
    };
    return api;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("dropCachedPhoto", () => {
    it("写真の入れ物から、その URL だけを捨てる", async () => {
        const api = fakeCaches();
        vi.stubGlobal("caches", api);

        await dropCachedPhoto("https://journey-photo.com/uploads/u1/a.jpg");

        // **入れ物の名前まで見る。** 別の名前を開いていても「例外が出ない」
        // だけで通ってしまう＝何も捨てていないのに緑になる
        expect(api.opened).toEqual(["journey-photo-img-v1"]);
        expect(api.get("journey-photo-img-v1")?.deleted)
            .toEqual(["https://journey-photo.com/uploads/u1/a.jpg"]);
    });

    it("URL が無ければ、入れ物を開きもしない", async () => {
        const api = fakeCaches();
        vi.stubGlobal("caches", api);

        await dropCachedPhoto("");
        await dropCachedPhoto(null);
        await dropCachedPhoto(undefined);

        expect(api.opened).toEqual([]);
    });

    it("Cache Storage が無い端末でも投げない", async () => {
        vi.stubGlobal("caches", undefined);
        await expect(dropCachedPhoto("https://journey-photo.com/uploads/u1/a.jpg")).resolves.toBeUndefined();
    });

    it("開けない・捨てられなくても投げない（画面を落とさない）", async () => {
        vi.stubGlobal("caches", { open: async () => { throw new Error("denied"); } });
        await expect(dropCachedPhoto("https://journey-photo.com/uploads/u1/a.jpg")).resolves.toBeUndefined();

        vi.stubGlobal("caches", { open: async () => ({ delete: async () => { throw new Error("denied"); } }) });
        await expect(dropCachedPhoto("https://journey-photo.com/uploads/u1/a.jpg")).resolves.toBeUndefined();
    });

    // **複製した名前は静かにずれる。** ずれても例外は出ず、ただ何も
    // 捨てなくなる（＝割れた画像が直らないまま、テストは緑）
    it("入れ物の名前が public/sw.js と一致している", () => {
        const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
        const version = /const IMG_CACHE_VERSION = "([^"]+)"/.exec(src)?.[1];
        expect(version, "sw.js から版を読めていない").toBeTruthy();
        expect(src).toContain("const IMG_CACHE_NAME = `journey-photo-img-${IMG_CACHE_VERSION}`");
        expect(PHOTO_CACHE_NAME).toBe(`journey-photo-img-${version}`);
    });
});
