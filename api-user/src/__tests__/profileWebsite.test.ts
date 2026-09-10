import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";

// **サーバー側に検証が1つも無かった。**
// `javascript:alert(1)` はそのまま DynamoDB に入る。いまは表示側
// （`UserProfileClient`）が `/^https?:\/\//` を見てリンクにしないので
// 実害は出ていないが、**表示する場所を1つ増やした瞬間に開く**。
// 曲の音源・アートワーク・写真のサムネは既にサーバーで塞いだのに、
// ここだけ「表示側の1本の判定」が唯一の砦だった（対の乖離）。

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

const { updateMyProfile } = await import("../userProfile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (body: unknown): Promise<Result> => (updateMyProfile as any)({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: JSON.stringify(body),
});

/** 実際に書き込まれたプロフィール（username# の予約は除く） */
const saved = () => commands
    .filter((c) => c.type === "Put" && !String((c.input.Item as Record<string, { S?: string }>)?.userId?.S ?? "").startsWith("username#"))
    .map((c) => c.input.Item as Record<string, { S?: string }>);

beforeEach(() => {
    commands.length = 0;
    mockSend.mockReset().mockImplementation(() =>
        commands[commands.length - 1]?.type === "Get"
            ? Promise.resolve({ Item: marshall({ userId: "u1", displayName: "旅人" }, { removeUndefinedValues: true }) })
            : Promise.resolve({}));
});

describe("プロフィールのウェブサイト: 実行できるスキームを保存しない", () => {
    it.each([
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "vbscript:msgbox(1)",
        // **タブで割った形**。URL のパーサはスキームの中のタブ・改行・CR を
        // 解釈の前に取り除くので、ブラウザはこれを `javascript:` として実行する
        // （`safeNextPath` がまったく同じ形で抜かれた）
        "java\tscript:alert(1)",
        "java\nscript:alert(1)",
        " javascript:alert(1)",       // 前後の空白（trim の前に見ると通る）
        // **列挙に戻さない。** 「javascript|data|vbscript を弾く」に
        // 置き換える変異は、この3つが無いと落ちない
        "file:///etc/passwd",
        "ms-msdt:/id",                // 英字以外を含むスキーム
        "intent://x",
    ])("%s は 400 で断る（保存しない）", async (website) => {
        const res = await invoke({ website });
        expect(res.statusCode, "実行できるスキームを保存している").toBe(400);
        expect(JSON.parse(res.body).error).toContain("http");
        expect(saved(), "断ったのに書き込んでいる").toEqual([]);
    });

    // 大文字も通す（`HTTPS://` を弾くと、そう打った人が保存できなくなる）
    it.each(["https://example.com", "http://example.com/path?a=1", "HTTPS://Example.com"])("%s は通す", async (website) => {
        expect((await invoke({ website })).statusCode).toBe(200);
        expect(saved()[0]?.website?.S).toBe(website);
    });

    // **スキームが無いものは今までどおり通す。** 弾くと、それを入れていた人が
    // プロフィールを保存できなくなる（今の画面はリンクとして出さないだけ）
    it("example.com（スキーム無し）は今までどおり保存できる", async () => {
        expect((await invoke({ website: "example.com" })).statusCode).toBe(200);
        expect(saved()[0]?.website?.S).toBe("example.com");
    });

    it("空にするのは通る（消す指定）", async () => {
        expect((await invoke({ website: "" })).statusCode).toBe(200);
    });

    // ほかの項目を触るだけの部分更新を巻き添えにしない
    it("website を送らない保存は素通り", async () => {
        expect((await invoke({ displayName: "旅人2" })).statusCode).toBe(200);
    });
});
