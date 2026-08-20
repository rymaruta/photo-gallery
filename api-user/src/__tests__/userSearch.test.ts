import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";

// DynamoDB をモック（Get: 予約アイテム/本人、Scan: 全ユーザー）
const mockSend = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class { send = mockSend; },
    GetItemCommand: class { input: unknown; readonly kind = "get"; constructor(input: unknown) { this.input = input; } },
    ScanCommand: class { input: unknown; readonly kind = "scan"; constructor(input: unknown) { this.input = input; } },
}));

const {searchUsers, scoreUser, normalizeQuery, isSearchableQuery, resetUserCache } = await import("../userSearch");

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (handler: unknown, event: unknown): Promise<LambdaResult> => (handler as any)(event);

const ev = (q?: string) => ({ queryStringParameters: q === undefined ? undefined : { q } });

const USERS = [
    { userId: "u1", username: "ryuhei", displayName: "丸田 竜平", bio: "旅と写真が好き" },
    { userId: "u2", username: "sakura_p", displayName: "さくら" },
    { userId: "u3", displayName: "Ryu Tanaka" },
    { userId: "username#ryuhei", ownerId: "u1" }, // 予約アイテム（結果に出してはいけない）
];

/** Scan だけ返し、Get は空（＝完全一致の速い経路は使わない）モック */
function mockScanOnly() {
    mockSend.mockImplementation((cmd: { kind: string }) => {
        if (cmd.kind === "scan") return Promise.resolve({ Items: USERS.map((u) => marshall(u)) });
        return Promise.resolve({});
    });
}

beforeEach(() => {
    // 一覧はインスタンス内で使い回すので、テストごとに捨てる
    resetUserCache();
    mockSend.mockReset();
});

describe("normalizeQuery", () => {
    it("前後の空白と先頭の @ を落とす", () => {
        expect(normalizeQuery("  @ryuhei ")).toBe("ryuhei");
        expect(normalizeQuery("@@sakura")).toBe("sakura");
    });
    it("文字列以外は空", () => {
        expect(normalizeQuery(undefined)).toBe("");
        expect(normalizeQuery(123)).toBe("");
    });
});

describe("scoreUser", () => {
    const hit = { userId: "u1", username: "ryuhei", displayName: "丸田 竜平" };
    it("@ユーザー名の完全一致が最優先", () => {
        expect(scoreUser(hit, "ryuhei")).toBe(100);
    });
    it("前方一致は部分一致より高い", () => {
        expect(scoreUser(hit, "ryu")).toBeGreaterThan(scoreUser(hit, "uhe"));
    });
    it("表示名でも一致する", () => {
        expect(scoreUser(hit, "竜平")).toBeGreaterThan(0);
    });
    it("一致しなければ0", () => {
        expect(scoreUser(hit, "zzzz")).toBe(0);
    });
});

describe("searchUsers", () => {
    it("英数字1文字では検索せず空で返す（DynamoDBも叩かない）", async () => {
        const res = await invoke(searchUsers, ev("a"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).users).toEqual([]);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("qが無くても200で空を返す", async () => {
        const res = await invoke(searchUsers, ev());
        expect(JSON.parse(res.body).users).toEqual([]);
    });

    it("表示名の部分一致で見つかる", async () => {
        mockScanOnly();
        const res = await invoke(searchUsers, ev("さくら"));
        const { users } = JSON.parse(res.body) as { users: Array<{ userId: string }> };
        expect(users.map((u) => u.userId)).toEqual(["u2"]);
    });

    it("ユーザー名の予約アイテムは結果に出さない", async () => {
        mockScanOnly();
        const res = await invoke(searchUsers, ev("ryu"));
        const { users } = JSON.parse(res.body) as { users: Array<{ userId: string }> };
        expect(users.some((u) => u.userId.startsWith("username#"))).toBe(false);
        // ryuhei（@一致）と Ryu Tanaka（表示名一致）の両方が出る
        expect(users.map((u) => u.userId).sort()).toEqual(["u1", "u3"]);
    });

    it("@ユーザー名の完全一致は先頭に来る", async () => {
        mockScanOnly();
        const res = await invoke(searchUsers, ev("@ryuhei"));
        const { users } = JSON.parse(res.body) as { users: Array<{ userId: string }> };
        expect(users[0].userId).toBe("u1");
    });

    it("完全一致は予約アイテム経由で直接引ける（スキャンに載っていなくても出る）", async () => {
        mockSend.mockImplementation((cmd: { kind: string; input: { Key?: Record<string, { S?: string }> } }) => {
            if (cmd.kind === "get") {
                const key = cmd.input.Key?.userId?.S;
                if (key === "username#ryuhei") return Promise.resolve({ Item: marshall({ userId: key, ownerId: "u1" }) });
                if (key === "u1") return Promise.resolve({ Item: marshall(USERS[0]) });
            }
            return Promise.resolve({ Items: [] }); // スキャンは空
        });
        const res = await invoke(searchUsers, ev("ryuhei"));
        const { users } = JSON.parse(res.body) as { users: Array<{ userId: string; username?: string }> };
        expect(users).toHaveLength(1);
        expect(users[0].username).toBe("ryuhei");
    });

    it("DynamoDBが落ちたら500", async () => {
        mockSend.mockRejectedValue(new Error("boom"));
        const res = await invoke(searchUsers, ev("さくら"));
        expect(res.statusCode).toBe(500);
    });
});

describe("isSearchableQuery", () => {
    it("英数字は2文字から", () => {
        expect(isSearchableQuery("a")).toBe(false);
        expect(isSearchableQuery("ab")).toBe(true);
    });
    it("日本語は1文字から（名前が短く、1文字でも十分絞り込めるため）", () => {
        expect(isSearchableQuery("た")).toBe(true);
        expect(isSearchableQuery("丸")).toBe(true);
    });
    it("空は不可", () => {
        expect(isSearchableQuery("")).toBe(false);
    });
});

// 以前は Scan を1ページ読んで LastEvaluatedKey を捨てていた。
// ユーザー名を登録した人は予約アイテムでもう1行増えるため、実質500人ほどで
// 打ち切られ、それ以降に登録した人は表示名で検索しても出てこなかった。
describe("searchUsers: スキャンのページ送り", () => {
    it("2ページ目にいるユーザーも見つかる", async () => {
        const page1 = [{ userId: "a1", displayName: "無関係" }];
        const page2 = [{ userId: "a2", displayName: "さくら" }];
        let call = 0;
        mockSend.mockImplementation((cmd: { kind: string }) => {
            if (cmd.kind !== "scan") return Promise.resolve({});
            call++;
            return call === 1
                ? Promise.resolve({ Items: page1.map((u) => marshall(u)), LastEvaluatedKey: marshall({ userId: "a1" }) })
                : Promise.resolve({ Items: page2.map((u) => marshall(u)) });
        });

        const res = await invoke(searchUsers, ev("さくら"));
        const users = JSON.parse(res.body).users as Array<{ userId: string }>;
        expect(users.map((u) => u.userId)).toContain("a2");
        expect(call).toBe(2);
    });

    it("予約アイテムはサーバー側のフィルタで除外する（読み取り枠を食わせない）", async () => {
        mockScanOnly();
        await invoke(searchUsers, ev("さくら"));
        const scanCall = mockSend.mock.calls.find((c) => (c[0] as { kind: string }).kind === "scan");
        const input = (scanCall![0] as { input: { FilterExpression?: string } }).input;
        expect(input.FilterExpression).toContain("NOT begins_with(userId");
    });

    it("ページを辿り続けても上限で止まる（検索語を変えた総なめを防ぐ）", async () => {
        let call = 0;
        mockSend.mockImplementation((cmd: { kind: string }) => {
            if (cmd.kind !== "scan") return Promise.resolve({});
            call++;
            // 常に「まだ続きがある」を返す
            return Promise.resolve({ Items: [], LastEvaluatedKey: marshall({ userId: `x${call}` }) });
        });
        await invoke(searchUsers, ev("さくら"));
        expect(call).toBe(10);
    });
});


// この口は未ログインでも叩ける。1リクエストで最大5,000件を読むので、
// 2文字の検索語を総当たりするだけ（676通り）で、その回数だけ
// テーブル全体の読み取りが起きていた。レスポンスに付けている
// public, max-age=60 は、API の手前に共有キャッシュが無いので効かない。
describe("searchUsers: 読み取りの使い回し", () => {
    const user = (id: string, name: string) => ({
        userId: { S: id }, displayName: { S: name },
    });

    it("検索語を変えてもテーブルは読み直さない", async () => {
        mockSend.mockResolvedValue({ Items: [user("u1", "たろう"), user("u2", "はなこ")] });

        await invoke(searchUsers, { queryStringParameters: { q: "たろ" } });
        const afterFirst = mockSend.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);

        // 別の検索語でもう一度
        await invoke(searchUsers, { queryStringParameters: { q: "はな" } });
        expect(mockSend.mock.calls.length).toBe(afterFirst);
    });

    it("使い回していても検索結果は検索語ごとに正しい", async () => {
        mockSend.mockResolvedValue({ Items: [user("u1", "たろう"), user("u2", "はなこ")] });

        const first = JSON.parse((await invoke(searchUsers, { queryStringParameters: { q: "たろ" } })).body);
        expect(first.users.map((u: { userId: string }) => u.userId)).toEqual(["u1"]);

        const second = JSON.parse((await invoke(searchUsers, { queryStringParameters: { q: "はな" } })).body);
        expect(second.users.map((u: { userId: string }) => u.userId)).toEqual(["u2"]);
    });
});
