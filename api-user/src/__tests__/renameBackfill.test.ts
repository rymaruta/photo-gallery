import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";

// **改名しても、写真の行に焼かれた表示名が永久に古いままだった。**
//
// `upload.ts` は投稿時に `lookupDisplayNameIfSet` の結果を写真の行へ焼く。
// ところが改名は users テーブルの1行しか触らず、写真の行を書き換える経路が
// **リポジトリのどこにも無かった**（`photoUpdate.ts` / `photosMutate.ts` /
// `sync-photos-from-ddb.js` のどれも `displayName` を扱わない）。
// 同期スクリプトは写真テーブルを Scan するだけで users を見ないので、
// **週1の定期ビルドでも直らない**——何度ビルドしても旧名が焼き直される。
//
// 古い名前が出るのは他人に見えるものばかり: JSON-LD の creator.name、
// プロフィールページの <title> / OGP、写真ページとモーダルの投稿者リンク。
// しかも**同じページの中で食い違う**——見出しは API のプロフィールを
// 優先するので新しい名前、<title> と OGP は写真の行なので古い名前。

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
        QueryCommand: make("Query"),
        UpdateItemCommand: make("Update"),
    };
});

const { updateMyProfile } = await import("../userProfile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (body: unknown): Promise<Result> => (updateMyProfile as any)({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: JSON.stringify(body),
});

/** 写真の行への更新（Key.id と、名前をどうしたか） */
const photoUpdates = () => commands
    .filter((c) => c.type === "Update")
    .map((c) => ({
        id: String((c.input.Key as Record<string, { S?: string }>)?.id?.S ?? ""),
        expr: String(c.input.UpdateExpression ?? ""),
        name: (c.input.ExpressionAttributeValues as Record<string, { S?: string }> | undefined)?.[":n"]?.S,
    }));

/** 保存済みプロフィール（旧名は「旅人」） */
const prev = { Item: marshall({ userId: "u1", displayName: "旅人", rev: 1 }, { removeUndefinedValues: true }) };
const photos = (ids: string[]) => ({ Items: ids.map((id) => marshall({ id })) });

/** Get→prev, Put→成功, Query→写真一覧, Update→成功 */
function wire(ids: string[], onUpdate?: () => void) {
    mockSend.mockReset().mockImplementation(() => {
        // 直前に積まれたコマンドの種類で応答を決める（モックの工場が push する）
        const t = commands[commands.length - 1]?.type;
        if (t === "Get") return Promise.resolve(prev);
        if (t === "Query") return Promise.resolve(photos(ids));
        if (t === "Update") { onUpdate?.(); return Promise.resolve({}); }
        return Promise.resolve({});
    });
}

beforeEach(() => { commands.length = 0; mockSend.mockReset(); });

describe("改名は、自分の写真の行にも反映される", () => {
    it("名前を変えたら、全部の写真を書き直す", async () => {
        wire(["p1", "p2", "p3"]);
        const res = await invoke({ displayName: "新しい名前" });
        expect(res.statusCode).toBe(200);

        const ups = photoUpdates();
        expect(ups.map((u) => u.id).sort(), "写真の行を書き直していない").toEqual(["p1", "p2", "p3"]);
        for (const u of ups) {
            expect(u.expr).toMatch(/SET displayName/);
            expect(u.name).toBe("新しい名前");
        }
    });

    // **毎回の保存で全件を書き直さない。** ピン留めや自己紹介だけ変えた
    // 保存で写真を100件書くのは、費用も実行時間も無駄
    it("名前が変わっていなければ、写真を触らない", async () => {
        wire(["p1", "p2"]);
        await invoke({ displayName: "旅人", bio: "自己紹介だけ変える" });
        expect(photoUpdates(), "変わっていないのに書き直している").toEqual([]);
    });

    it("名前を送っていない保存でも触らない", async () => {
        wire(["p1"]);
        await invoke({ bio: "自己紹介だけ" });
        expect(photoUpdates()).toEqual([]);
    });

    // 空にしたら属性ごと外す。空文字を焼くと「名前を持っている人」として
    // 扱われ、既定名（名前未設定さん）に落ちない
    it("名前を消したら、属性ごと外す", async () => {
        wire(["p1"]);
        await invoke({ displayName: "" });
        const ups = photoUpdates();
        expect(ups).toHaveLength(1);
        expect(ups[0].expr).toMatch(/REMOVE displayName/);
        expect(ups[0].name, "消すのに値を渡している").toBeUndefined();
    });

    // 自分の写真だけ。GSI をユーザーで引く
    it("引くのは自分の写真だけ", async () => {
        wire(["p1"]);
        await invoke({ displayName: "新しい名前" });
        const q = commands.find((c) => c.type === "Query");
        expect(q, "GSI を引いていない").toBeDefined();
        expect(String(q!.input.KeyConditionExpression)).toMatch(/userId = :u/);
        expect((q!.input.ExpressionAttributeValues as Record<string, { S?: string }>)[":u"].S).toBe("u1");
    });
});

describe("写しの書き直しは、改名そのものを失敗させない", () => {
    // ここで投げると「改名しました」が出ずに元どおりになる。
    // 写しがずれるのは今までどおりで、悪化はしない
    it("写真の更新が全部落ちても 200", async () => {
        wire(["p1", "p2"], () => { throw new Error("throughput exceeded"); });
        const res = await invoke({ displayName: "新しい名前" });
        expect(res.statusCode, "写しの失敗で改名ごと落としている").toBe(200);
        expect(JSON.parse(res.body).displayName).toBe("新しい名前");
    });

    it("写真一覧が引けなくても 200", async () => {
        mockSend.mockReset().mockImplementation(() => {
            const t = commands[commands.length - 1]?.type;
            if (t === "Get") return Promise.resolve(prev);
            if (t === "Query") return Promise.reject(new Error("index missing"));
            return Promise.resolve({});
        });
        expect((await invoke({ displayName: "新しい名前" })).statusCode).toBe(200);
    });

    // 写真が0枚の人でも壊れない
    it("写真が無ければ何も書かない（が 200）", async () => {
        wire([]);
        expect((await invoke({ displayName: "新しい名前" })).statusCode).toBe(200);
        expect(photoUpdates()).toEqual([]);
    });
});
