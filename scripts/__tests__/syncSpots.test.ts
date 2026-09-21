import { describe, it, expect } from "vitest";

// 本体は require 時に PHOTOS_TABLE を要求する（本番値のフォールバックを置かない規則）
process.env.PHOTOS_TABLE = process.env.PHOTOS_TABLE ?? "test-photo-gallery-photos";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sync = require("../sync-photos-from-ddb.js") as {
    publicSpots: (items: Record<string, unknown>[]) => Array<Record<string, unknown>>;
    SPOT_ID_PREFIX: string;
};

describe("publicSpots", () => {
    const items = [
        { id: "spot#sp_1", spotId: "sp_1", slug: "takaya-jinja", name: "高屋神社" },
        { id: "spot#sp_2", spotId: "sp_2", slug: "draft", name: "下書き", status: "draft" },
        { id: "spot#sp_3", spotId: "sp_3", name: "slug が無い" },
        { id: "uploads/a.jpg", src: "/uploads/a.jpg" },
        { id: "like#uploads/a.jpg#u1" },
    ];

    it("台帳の行だけを拾う（写真・マーカーは入らない）", () => {
        expect(sync.publicSpots(items).map((s) => s.spotId)).toEqual(["sp_1"]);
    });

    it("下書きは出さない", () => {
        expect(sync.publicSpots(items).some((s) => s.spotId === "sp_2")).toBe(false);
    });

    it("slug の無い行は出さない（URL を作れない＝ページにできない）", () => {
        expect(sync.publicSpots(items).some((s) => s.spotId === "sp_3")).toBe(false);
    });

    it("内部の鍵（id）は書き出さない", () => {
        expect(Object.hasOwn(sync.publicSpots(items)[0], "id")).toBe(false);
    });
});
