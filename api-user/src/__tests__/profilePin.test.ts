import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// ピン留めは配列まるごとを PUT していた。rev（楽観ロック）が守れるのは
// 「この処理中に他の書き込みが割り込んだ」場合だけで、実際に起きるのは
// **PC のタブを開きっぱなしにしたまま、スマホでピン留めする**——
// 数時間後に PC 側で別の写真をピン留めすると、PC が開いた時点の配列
// （スマホの1枚を含まない）で丸ごと置き換わり、スマホの分が消える。
// サーバーは新しい rev を普通に書けるので競合として検出されない。
//
// 増減（{ pinPhotoId, pin }）で受け取り、**その瞬間に読んだ配列**の上で
// 足し引きする。follow.ts の updateFollowing と同じ考え方。

const mockSend = vi.hoisted(() => vi.fn());
const commands = vi.hoisted(() => [] as { type: string; input: Record<string, unknown> }[]);

vi.mock("@aws-sdk/client-dynamodb", () => {
    const make = (type: string) => class {
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) { this.input = input; commands.push({ type, input }); }
    };
    return {
        DynamoDBClient: class { send = mockSend; },
        GetItemCommand: make("Get"),
        PutItemCommand: make("Put"),
        DeleteItemCommand: make("Delete"),
    };
});

const { updateMyProfile, removePinnedPhoto } = await import("../userProfile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (body: unknown): Promise<Result> => (updateMyProfile as any)({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: JSON.stringify(body),
});

const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
const stored = (over: Record<string, unknown>) =>
    ({ Item: marshall({ userId: "u1", displayName: "旅人", ...over }, { removeUndefinedValues: true }) });

/** 実際に書き込まれたプロフィール（username# の予約は除く） */
function savedProfile(): Record<string, unknown> {
    const puts = commands
        .filter((c) => c.type === "Put" && !String((c.input.Item as Record<string, { S?: string }>)?.userId?.S ?? "").startsWith("username#"));
    if (puts.length === 0) throw new Error("プロフィールが書かれていない");
    return unmarshall(puts[puts.length - 1].input.Item as Parameters<typeof unmarshall>[0]);
}

beforeEach(() => {
    commands.length = 0;
    mockSend.mockReset();
});

describe("ピン留めは増減で受け取る", () => {
    it("保存済みの1枚を残したまま足す（開きっぱなしのタブが消さない）", async () => {
        // スマホが先に p9 をピン留めしている
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 4 }))   // getProfile
            .mockResolvedValueOnce({});                                          // Put
        // PC のタブは p9 を知らない（開いた時点では空だった）
        const res = await invoke({ pinPhotoId: "p1", pin: true });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p9", "p1"]);
    });

    it("解除も保存済みの配列から引く（他の1枚は残る）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9", "p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        const res = await invoke({ pinPhotoId: "p1", pin: false });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p9"]);
    });

    it("最後の1枚を解除したら項目ごと消える", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        await invoke({ pinPhotoId: "p1", pin: false });

        expect(savedProfile()).not.toHaveProperty("pinnedPhotoIds");
    });

    it("同じ写真を二度ピン留めしても増えない（冪等）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        const res = await invoke({ pinPhotoId: "p1", pin: true });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p1"]);
    });

    it("保存済みが既に3枚なら 409。黙って落として 200 にしない", async () => {
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "b", "c"], rev: 4 }));
        const res = await invoke({ pinPhotoId: "d", pin: true });

        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error).toContain("3枚");
        // 書き込みに行っていない
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    // 断るだけだと、手元がサーバーとずれているタブは直せない。
    // 「星が1つも無いのに3枚までと言われる」まま何度でも同じことになる。
    it("上限で断るときは、今の一覧を添えて返す", async () => {
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "b", "c"], rev: 4 }));
        const res = await invoke({ pinPhotoId: "d", pin: true });

        expect(JSON.parse(res.body).pinnedPhotoIds).toEqual(["a", "b", "c"]);
    });

    it("競合して読み直したら、**読み直した方**の配列に重ねる", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: [], rev: 4 }))          // 1回目の getProfile
            .mockRejectedValueOnce(condFail())                                      // Put が競合
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 5 }))      // 読み直し
            .mockResolvedValueOnce({});                                             // Put
        const res = await invoke({ pinPhotoId: "p1", pin: true });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p9", "p1"]);
    });

    it("pin が真偽値でなければ 400（既定で外す方に倒さない）", async () => {
        const res = await invoke({ pinPhotoId: "p1" });
        expect(res.statusCode).toBe(400);
        expect(mockSend).not.toHaveBeenCalled();
    });
});

describe("配列形式は残す（古いタブが読み込んだままの JS のため）", () => {
    it("pinnedPhotoIds の配列はこれまでどおり置き換える", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 4 }))
            .mockResolvedValueOnce({});
        const res = await invoke({ pinnedPhotoIds: ["p1"] });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p1"]);
    });

    it("両方来たら増減を採る（配列は古いタブの持ち物）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 4 }))
            .mockResolvedValueOnce({});
        await invoke({ pinnedPhotoIds: ["p1"], pinPhotoId: "p2", pin: true });

        expect(savedProfile().pinnedPhotoIds).toEqual(["p9", "p2"]);
    });
});


// 写真を消してもピンの枠は空かなかった。applyPinOp は上限(3)を配列長だけで
// 数え、写真の実在を見ない。一方で画面は見つからないピンを黙って落とすので、
// 「3枚留めた → 1枚消した → もう1枚留めようとすると 409。でも画面には2枚しか
// 出ていない」で詰む（解除ボタンは表示された写真にしか無く、増減方式なので
// 消えたピンを外す手段が無い）。写真削除のときに外す。
describe("removePinnedPhoto", () => {
    it("該当のピンだけ外す（他は残す）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "p1", "b"], rev: 4 }))
            .mockResolvedValueOnce({});
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(savedProfile().pinnedPhotoIds).toEqual(["a", "b"]);
    });

    it("最後の1枚なら項目ごと消す", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        await removePinnedPhoto("u1", "p1");
        expect(savedProfile()).not.toHaveProperty("pinnedPhotoIds");
    });

    it("留めていない写真なら書き込まない", async () => {
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: ["other"], rev: 4 }));
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    it("プロフィール行が無い・墓石なら何もしない", async () => {
        mockSend.mockResolvedValueOnce({});
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        mockSend.mockResolvedValueOnce(stored({ deletedAt: "2026-08-27T00:00:00.000Z", pinnedPhotoIds: ["p1"] }));
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    it("競合したら読み直して重ね直す（rev 方式）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["z", "p1"], rev: 5 }))
            .mockResolvedValueOnce({});
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(savedProfile().pinnedPhotoIds).toEqual(["z"]);
    });

    // 落ちたことを黙って飲むと、呼び出し側が「外せた」と思って行を消し、
    // 宙に浮いたピンが残る
    it("失敗したら false（呼び出し側が止められるように）", async () => {
        mockSend.mockRejectedValue(new Error("boom"));
        expect(await removePinnedPhoto("u1", "p1")).toBe(false);
    });
});
