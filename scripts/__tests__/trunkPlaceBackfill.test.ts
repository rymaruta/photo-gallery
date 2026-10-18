import { describe, it, expect, vi } from "vitest";

/**
 * 本番にもう在るトランクのラベルに「地名を人に見せてよい」印（`o: 1`）を足す台本（`backfill-trunk-place-ok.js`）。
 * 判定は Lambda と同じ `api-user/src/trunkPlace.ts` を使う（ここでも本物を渡す）
 */
vi.stubEnv("PHOTOS_TABLE", "photos-test");
vi.stubEnv("USERS_TABLE", "users-test");
const lib = await import("../../api-user/src/trunkPlace");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { planRow, photoIdsOf, estimate } = require("../backfill-trunk-place-ok.js");

const U = "11111111-1111-4111-8111-111111111111";
const pub = (id: string, over: Record<string, unknown> = {}) => ({
    id, userId: U, src: `https://cdn.example.com/${id}.webp`, published: true, location: "京都, Kyoto", ...over,
});
const lab = (i: string, over: Record<string, unknown> = {}) => ({ i, k: "p", n: "京都", l: "Kyoto", c: "日本", d: 1, a: 1, ...over });

describe("印を足す台本（planRow）", () => {
    it("誰にでも見える公開・撮影地が同じ写真のラベルにだけ印を付ける", () => {
        const row = {
            id: `trunk#${U}`, uid: U, rev: 2,
            pocket: [lab("a"), lab("b"), lab("c"), lab("d"), lab("e")],
            stuck: [lab("f", { o: 1 }), { id: "old-long-form", place: { name: "京都" } }],
        };
        const photos = new Map<string, Record<string, unknown> | undefined>([
            ["a", pub("a")],
            ["b", pub("b", { audience: "followers" })],
            ["c", pub("c", { published: false })],
            ["d", pub("d", { location: "大阪" })],
            ["e", undefined],
            ["f", pub("f", { userId: "someone-else" })],
        ]);
        const plan = planRow(lib, row, photos);
        expect(plan.pocket.map((l: Record<string, unknown>) => l.o ?? null)).toEqual([1, null, null, null, null]);
        // 前に付いていても、今の写真で確かめられなければ外す
        expect(plan.stuck[0].o).toBeUndefined();
        // 長い鍵の古い形は触らない（印が無いまま＝伏せたまま）
        expect(plan.stuck[1]).toEqual({ id: "old-long-form", place: { name: "京都" } });
        expect([plan.added, plan.removed, plan.labels, plan.write]).toEqual([1, 1, 6, true]);
    });

    it("変わらなければ書かない・写真の id は重ねて読まない", () => {
        const row = { id: `trunk#${U}`, uid: U, pocket: [lab("a", { o: 1 })], stuck: [lab("a", { o: 1 })] };
        expect(planRow(lib, row, new Map([["a", pub("a")]])).write).toBe(false);
        expect(photoIdsOf(row)).toEqual(["a"]);
    });

    it("見積もり: Scan は 4KB ごとに 0.5 単位", () => {
        expect(estimate({ tableBytes: 8192 * 10, itemCount: 100 }).scanUnits).toBe(10);
    });
});
