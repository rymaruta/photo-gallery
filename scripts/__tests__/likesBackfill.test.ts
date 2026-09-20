import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `likes#<uid>`（いいねした写真の一覧）は、**既にあるいいねには無い**
 * ——`likes.ts` は今後のいいねにしか書かない。埋め戻しの中身をここで固定する。
 *
 * owner の報告:「いいねした写真を見てもいいねした写真がない」。
 * この埋め戻しを流すまで、それまでに押したいいねは別の端末に出ない。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseMarker, buildLikes, mergeIds, LIKED_MAX, SKIP_REASONS, main } = require("../backfill-likes.js");

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

describe("いいねの埋め戻し", () => {
    it("マーカーを分解する", () => {
        expect(parseMarker({ id: `like#${P1}#${U1}`, like: true, createdAt: "2026-01-01" }))
            .toEqual({ photoId: P1, uid: U1, createdAt: "2026-01-01" });
    });

    it.each([
        [{ id: `like#${P1}#${U1}` }],                        // like: true が無い
        [{ id: `like#${P1}`, like: true }],                  // 形が足りない
        [{ id: `like##${U1}`, like: true }],                 // 空のセグメント
        [{ id: `like#${P1}#not-a-uuid`, like: true }],       // 利用者IDの形でない
        [{ id: `likes#${U1}`, like: true }],                 // 一覧の行そのもの
        [{ id: `follow#${U1}#${U2}`, like: true }],          // 別のマーカー
    ])("いいねのマーカーでない行は捨てる: %j", (item) => {
        expect(parseMarker(item).skip, "理由を返していない").toBeTruthy();
        expect(parseMarker(item).photoId).toBeUndefined();
    });

    // **写真IDの形は要求しない。** 採番が変わった時代の写真も拾う
    it("写真IDが uuid でなくても拾う", () => {
        expect(parseMarker({ id: `like#legacy-photo-7#${U1}`, like: true }).photoId).toBe("legacy-photo-7");
    });

    it("捨てた件数を理由ごとに数える", () => {
        const out = buildLikes([
            { id: `like#${P1}#${U1}`, like: true },
            { id: `like#${P1}#${U1}` },
            { id: `like#${P1}#nope`, like: true },
        ]);
        expect(out.size).toBe(1);
        expect(out.skipped.get(SKIP_REASONS.NOT_MARKER)).toBe(1);
        expect(out.skipped.get(SKIP_REASONS.NOT_USER_ID)).toBe(1);
    });

    // **新しい順。** サーバー側（`unshift`）と同じ並びでないと、
    // 埋め戻した直後と以後の書き込みで順序が食い違う
    it("人ごとに、新しくいいねした順で並べる", () => {
        const out = buildLikes([
            { id: `like#${P1}#${U1}`, like: true, createdAt: "2026-01-01" },
            { id: `like#${P2}#${U1}`, like: true, createdAt: "2026-03-01" },
            { id: `like#${P1}#${U2}`, like: true, createdAt: "2026-02-01" },
        ]);
        expect(out.get(U1)).toEqual([P2, P1]);
        expect(out.get(U2)).toEqual([P1]);
    });

    it("createdAt を持たない古いマーカーは末尾へ", () => {
        const out = buildLikes([
            { id: `like#${P1}#${U1}`, like: true },
            { id: `like#${P2}#${U1}`, like: true, createdAt: "2026-01-01" },
        ]);
        expect(out.get(U1)).toEqual([P2, P1]);
    });

    // **走っている間に押されたいいねを消さない**（既存が先）
    it("既にある一覧と併合する（重複しない・既存が先）", () => {
        expect(mergeIds([P2], [P1, P2])).toEqual([P2, P1]);
        expect(mergeIds([], [P1, P1])).toEqual([P1]);
        expect(mergeIds([P1], [])).toEqual([P1]);
    });

    it("壊れた値は落とす", () => {
        expect(mergeIds([null, "", 7, P1] as unknown as string[], [P2])).toEqual([P1, P2]);
    });

    it("上限で切る", () => {
        const many = Array.from({ length: LIKED_MAX + 10 }, (_, i) => `p${i}`);
        expect(mergeIds([], many)).toHaveLength(LIKED_MAX);
    });

    /**
     * **上限はサーバー側と同じでなければならない。**
     * 大きいと 400KB の項目上限に近づき、小さいと埋め戻した直後に
     * サーバー側の書き込みが切り詰めて食い違う。
     */
    it("上限が api-user/src/likes.ts の LIKED_MAX と一致する", () => {
        const src = readFileSync(join(process.cwd(), "api-user/src/likes.ts"), "utf8");
        const m = src.match(/const LIKED_MAX = (\d+);/);
        expect(m, "api-user 側の LIKED_MAX が見つからない").toBeTruthy();
        expect(Number(m![1])).toBe(LIKED_MAX);
    });
});

/**
 * **本番データに1回だけ流す破壊的なスクリプトなので `main()` にも当てる**
 * （`backfill-followers.js` と同じ判断）。
 */
describe("backfill-likes の main()", () => {
    const setup = (items: unknown[], existing: Record<string, unknown> = {}) => {
        const sent: Array<{ kind: string; input: Record<string, unknown> }> = [];
        const lib = {
            ScanCommand: class { input: Record<string, unknown>; kind = "Scan"; constructor(i: Record<string, unknown>) { this.input = i; } },
            GetCommand: class { input: Record<string, unknown>; kind = "Get"; constructor(i: Record<string, unknown>) { this.input = i; } },
            PutCommand: class { input: Record<string, unknown>; kind = "Put"; constructor(i: Record<string, unknown>) { this.input = i; } },
        };
        const ddb = {
            send: vi.fn(async (c: { kind: string; input: Record<string, unknown> }) => {
                sent.push({ kind: c.kind, input: c.input });
                if (c.kind === "Scan") return { Items: items, ScannedCount: items.length };
                if (c.kind === "Get") return existing[(c.input.Key as { id: string }).id] ?? {};
                return {};
            }),
        };
        return { lib, ddb, sent };
    };

    it("ドライランでは書き込まない", async () => {
        const { lib, ddb, sent } = setup([{ id: `like#${P1}#${U1}`, like: true }]);
        vi.stubEnv("PHOTOS_TABLE", "t");
        const argv = process.argv;
        process.argv = ["node", "backfill-likes.js"];
        await main({ lib, ddb });
        process.argv = argv;
        vi.unstubAllEnvs();
        expect(sent.some((s) => s.kind === "Put"), "ドライランなのに書いている").toBe(false);
    });

    it("--apply で書く。rev を引き継ぎ、条件を付ける", async () => {
        const { lib, ddb, sent } = setup(
            [{ id: `like#${P1}#${U1}`, like: true }],
            { [`likes#${U1}`]: { Item: { list: [P2], rev: 3 } } },
        );
        vi.stubEnv("PHOTOS_TABLE", "t");
        const argv = process.argv;
        process.argv = ["node", "backfill-likes.js", "--apply"];
        await main({ lib, ddb });
        process.argv = argv;
        vi.unstubAllEnvs();
        const put = sent.find((s) => s.kind === "Put");
        expect(put, "書いていない").toBeTruthy();
        expect(put!.input.Item).toMatchObject({ id: `likes#${U1}`, uid: U1, list: [P2, P1], rev: 4 });
        expect(put!.input.ConditionExpression).toBe("rev = :rev");
        expect(put!.input.ExpressionAttributeValues).toEqual({ ":rev": 3 });
    });

    // **`like` は DynamoDB の予約語ではないが、`#l` で逃がしてある。**
    // 逃がしを外すと Scan が ValidationException で落ちる形もあるので固定する
    it("Scan はいいねのマーカーだけを拾う", async () => {
        const { lib, ddb, sent } = setup([]);
        vi.stubEnv("PHOTOS_TABLE", "t");
        const argv = process.argv;
        process.argv = ["node", "backfill-likes.js"];
        await main({ lib, ddb });
        process.argv = argv;
        vi.unstubAllEnvs();
        const scan = sent.find((s) => s.kind === "Scan")!;
        expect(scan.input.FilterExpression).toContain(":t");
        expect(scan.input.ExpressionAttributeValues).toEqual({ ":t": true });
    });

    it("競合したら上書きせず、終了コードで知らせる", async () => {
        const { lib, ddb } = setup(
            [{ id: `like#${P1}#${U1}`, like: true }],
            { [`likes#${U1}`]: { Item: { list: [], rev: 1 } } },
        );
        ddb.send = vi.fn(async (c: { kind: string }) => {
            if (c.kind === "Scan") return { Items: [{ id: `like#${P1}#${U1}`, like: true }], ScannedCount: 1 };
            if (c.kind === "Get") return { Item: { list: [], rev: 1 } };
            throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        }) as unknown as typeof ddb.send;
        vi.stubEnv("PHOTOS_TABLE", "t");
        const argv = process.argv;
        process.argv = ["node", "backfill-likes.js", "--apply"];
        const prev = process.exitCode;
        await main({ lib, ddb });
        expect(process.exitCode, "黙って成功として終わっている").toBe(1);
        process.exitCode = prev;
        process.argv = argv;
        vi.unstubAllEnvs();
    });
});
