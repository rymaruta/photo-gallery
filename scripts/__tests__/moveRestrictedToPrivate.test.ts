import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planBackfill, rewriteUpdate, isRestrictedRow, skipKeptAlive, applyEntries, runBackfill, type ApplyDeps } from "../move-restricted-to-private";
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

    // 読んだあとに差し替えられていたら、古い計画で書くと差し替えを黙って古い画像へ戻す
    it("読んだときの src のままのときだけ書く（差し替えを戻さない）", () => {
        const u = rewriteUpdate(planBackfill([row()]).entries[0]);
        expect(u.ConditionExpression).toContain("#src = :oldSrc");
        expect(u.ExpressionAttributeNames["#src"]).toBe("src");
        expect(u.ExpressionAttributeValues[":oldSrc"]).toBe(`${CDN}/uploads/u1/p1.jpg`);
    });
});

describe("残した写真（元のストーリーが出ている間は移さない）", () => {
    it("元のストーリーが生きていれば飛ばし、消えていれば移す・読めなければ飛ばす", async () => {
        const plan = planBackfill([
            row({ id: "alive", keptFrom: "s1" }),
            row({ id: "gone", keptFrom: "s2" }),
            row({ id: "broken", keptFrom: "s3" }),
            row({ id: "plain" }),
        ]);
        const out = await skipKeptAlive(plan.entries, async (id) => {
            if (id === "s3") throw new Error("read failed");
            return id === "s1";
        });
        expect(out.entries.map((e) => e.id)).toEqual(["gone", "plain"]);
        expect(out.keptAlive).toBe(1);
        expect(out.unknown).toBe(1);
    });
});

describe("移す順と、元が残ったときの数え方", () => {
    const deps = (over: Partial<ApplyDeps> = {}, log: string[] = []): ApplyDeps => ({
        copyAll: async () => { log.push("copy"); return true; },
        update: async () => { log.push("update"); },
        dropUnused: async () => { log.push("drop"); },
        exists: async () => { log.push("head"); return false; },
        ...over,
    });

    it("コピー → 行の書き換え → 元を消す → 消えたか確かめる（photoUpdate と同じ順）", async () => {
        const log: string[] = [];
        const r = await applyEntries(planBackfill([row()]).entries, deps({}, log));
        expect(log.slice(0, 3)).toEqual(["copy", "update", "drop"]);
        expect(log.slice(3).every((x) => x === "head")).toBe(true);
        expect(r).toEqual({ moved: 1, failed: 0, leftovers: [], failedIds: [] });
    });

    it("コピーに失敗したら行も元も触らない", async () => {
        const log: string[] = [];
        const r = await applyEntries(planBackfill([row()]).entries, deps({ copyAll: async () => false }, log));
        expect(log).toEqual([]);
        expect(r.failed).toBe(1);
    });

    it("行を書けなかったら元を消さない", async () => {
        const log: string[] = [];
        const r = await applyEntries(planBackfill([row()]).entries,
            deps({ update: async () => { throw Object.assign(new Error("x"), { name: "ConditionalCheckFailedException" }); } }, log));
        expect(log).toEqual(["copy"]);
        expect(r.failed).toBe(1);
    });

    it("🔴 元が uploads/ に残っていたら「移した」に数えない（失敗に数えて残りを返す）", async () => {
        const r = await applyEntries(planBackfill([row()]).entries,
            deps({ exists: async (k) => k === "uploads/u1/p1.jpg" }));
        expect(r.moved).toBe(0);
        expect(r.failed).toBe(1);
        expect(r.leftovers).toEqual(["uploads/u1/p1.jpg"]);
        expect(r.failedIds, "失敗した行の id を出さないと、やり直しで拾えない行を探せない").toEqual(["p1"]);
    });

    it("在るか確かめられなければ「残っている」側に倒す", async () => {
        const r = await applyEntries(planBackfill([row()]).entries,
            deps({ exists: async () => { throw new Error("denied"); } }));
        expect(r.moved).toBe(0);
        expect(r.failed).toBe(1);
    });
});

describe("既定と終了コード", () => {
    const src = readFileSync(join(__dirname, "..", "move-restricted-to-private.ts"), "utf8");

    it("既定は下見（--apply が無ければ書かない）・適用には無効化先が要る", () => {
        expect(src).toContain('process.argv.includes("--apply")');
        expect(src).toMatch(/apply: process\.argv\.includes\("--apply"\)|const apply = process\.argv\.includes\("--apply"\)/);
        expect(src).toMatch(/apply && !process\.env\.CLOUDFRONT_DISTRIBUTION_ID/);
    });

    it("失敗（元が残ったものを含む）があれば終了コードを非0にする", () => {
        expect(src).toMatch(/const \{ failed \} = await runBackfill\(/);
        expect(src).toContain("if (failed > 0) process.exitCode = 1;");
    });
});

/** main の配線（計画 → 残した写真の除外 → 移す）。AWS の代わりに差し替えた部品で流す */
describe("runBackfill（main の配線）", () => {
    const items = () => [
        row({ id: "alive", keptFrom: "s-alive" }),
        row({ id: "plain" }),
    ];
    const recordingDeps = (copied: string[]): ApplyDeps => ({
        copyAll: async (_m, tag) => { copied.push(tag); return true; },
        update: async () => {},
        dropUnused: async () => {},
        exists: async () => false,
    });

    it("🔴 元のストーリーが生きている写真は、移す側に渡さない", async () => {
        const copied: string[] = [];
        const r = await runBackfill({
            items: items(), apply: true, log: () => {},
            storyAlive: async (id) => id === "s-alive",
            makeDeps: async () => recordingDeps(copied),
        });
        expect(copied).toEqual(["move-restricted(plain)"]);
        expect(r.kept.keptAlive).toBe(1);
        expect(r.moved).toBe(1);
    });

    it("下見では移す部品を作りもしない（AWS の部品を読み込まない）", async () => {
        let made = false;
        const lines: string[] = [];
        const r = await runBackfill({
            items: items(), apply: false, log: (l) => lines.push(l),
            storyAlive: async () => false,
            makeDeps: async () => { made = true; return recordingDeps([]); },
        });
        expect(made).toBe(false);
        expect(r.moved).toBe(0);
        expect(lines.join("\n")).toContain("uploads/ に実体が残っている行: 2 件");
    });

    it("失敗した行の id を出す（元が残った行はやり直しで拾わない）", async () => {
        const lines: string[] = [];
        const r = await runBackfill({
            items: [row({ id: "stuck" })], apply: true, log: (l) => lines.push(l),
            storyAlive: async () => false,
            makeDeps: async () => ({ ...recordingDeps([]), exists: async () => true }),
        });
        expect(r.failed).toBe(1);
        expect(lines.join("\n")).toContain("stuck");
    });
});
