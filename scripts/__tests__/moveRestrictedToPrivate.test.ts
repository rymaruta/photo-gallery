import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planBackfill, rewriteUpdate, isRestrictedRow } from "../move-restricted-to-private";
import { PRIVATE_PREFIX } from "../../api-user/src/privateMove";

/**
 * 絞った写真で `uploads/` に残っている実体を `private/` へ移す道具（2026-10-18）。
 * 本番の S3 と DynamoDB を書くので、**何を移すか**と**行の書き方**をここで固定する。
 */
const CDN = "https://cdn.example.com";
const row = (over: Record<string, unknown> = {}) => ({
    id: "p1", userId: "u1", audience: "followers",
    src: `${CDN}/uploads/u1/p1.jpg`, thumbSrc: `${CDN}/uploads/u1/p1-thumb.webp`,
    srcOriginal: `${CDN}/uploads/originals/u1/p1.jpg`,
    extraImages: [{ src: `${CDN}/uploads/u1/p2.jpg`, width: 10 }],
    ...over,
});

describe("移す計画", () => {
    it("uploads/ に残る絞った写真の、派生・原本・2枚目以降まで全部を移す", () => {
        const plan = planBackfill([row()]);
        expect(plan.restricted).toBe(1);
        expect(plan.entries).toHaveLength(1);
        expect(plan.objects).toBe(4);
        expect(plan.entries[0].moves.every((m) => m.to.startsWith(PRIVATE_PREFIX))).toBe(true);
        expect(plan.entries[0].rewritten.src).toBe(`${CDN}/private/u1/p1.jpg`);
        expect((plan.entries[0].rewritten.extraImages as { src: string; width: number }[])[0])
            .toEqual({ src: `${CDN}/private/u1/p2.jpg`, width: 10 });
    });

    it("公開の写真（audience 無し・空）には触らない", () => {
        const plan = planBackfill([row({ audience: undefined }), row({ id: "p2", audience: "" })]);
        expect(plan.restricted).toBe(0);
        expect(plan.entries).toEqual([]);
    });

    it("知らない値の audience も絞った側に倒す（公開の置き場に残さない）", () => {
        expect(isRestrictedRow({ audience: "frends" })).toBe(true);
        expect(isRestrictedRow({ audience: "  " })).toBe(false);
    });

    it("もう private/ に在る行は数えるが移さない（二度流しても何もしない）", () => {
        const done = planBackfill([row()]).entries[0].rewritten;
        const plan = planBackfill([{ ...row(), ...done }]);
        expect(plan.restricted).toBe(1);
        expect(plan.entries).toEqual([]);
    });

    it("ストーリーは移さない（第2段。読み手がまだ署名しない）", () => {
        const plan = planBackfill([row({ story: true })]);
        expect(plan.entries).toEqual([]);
        expect(plan.skipped.story).toBe(1);
    });

    it("持ち主の分からない行は移さない（ほかの行が使っているか確かめられない）", () => {
        const plan = planBackfill([row({ userId: undefined })]);
        expect(plan.entries).toEqual([]);
        expect(plan.skipped.noOwner).toBe(1);
    });
});

describe("行の書き換え", () => {
    it("移した先の URL を1回の更新で書き、消えた行・公開へ戻した行には書かない", () => {
        const u = rewriteUpdate(planBackfill([row()]).entries[0]);
        expect(u.Key).toEqual({ id: "p1" });
        expect(Object.values(u.ExpressionAttributeNames)).toEqual(
            expect.arrayContaining(["src", "thumbSrc", "srcOriginal", "extraImages"]));
        expect(u.ConditionExpression).toContain("attribute_exists(id)");
        expect(u.ConditionExpression).toContain("attribute_exists(audience)");
    });
});

describe("順番と既定", () => {
    const src = readFileSync(join(__dirname, "..", "move-restricted-to-private.ts"), "utf8");

    it("コピー → 行の書き換え → 元を消す（photoUpdate と同じ順）", () => {
        const copy = src.indexOf("await copyAll(");
        const update = src.indexOf("new UpdateCommand(");
        const drop = src.indexOf("await dropUnusedKeys(");
        expect(copy).toBeGreaterThan(0);
        expect(update).toBeGreaterThan(copy);
        expect(drop).toBeGreaterThan(update);
    });

    it("既定は下見（--apply が無ければ書かない）・適用には無効化先が要る", () => {
        expect(src).toContain('process.argv.includes("--apply")');
        expect(src).toMatch(/if \(!apply\) \{[\s\S]*?return;/);
        expect(src).toMatch(/apply && !process\.env\.CLOUDFRONT_DISTRIBUTION_ID/);
    });
});
