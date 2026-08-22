import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";

// プロフィールの保存は「読む → 全置換 Put」だった。書き手は2つある——
// プロフィール編集画面（app/user/profile/page.tsx）と、ピン留め・旅アルバムの
// 設定（app/users/UserProfileClient.tsx）。同時に走ると後勝ちで、
// **先の変更が黙って消える**。このファイルのコメントが挙げている過去2件の
// 事故（「ピン留めするだけで旅アルバムとひとことが消える」）と症状が同じ。
//
// follow.ts の updateFollowing と同じ rev 方式で直した。
// 競合したら読み直して、この呼び出しの変更を最新の上に重ね直す。

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

const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
const profileItem = (over: Record<string, unknown>) =>
    ({ Item: marshall({ userId: "u1", displayName: "旅人", ...over }, { removeUndefinedValues: true }) });

/** 実際に書き込まれたプロフィール（username# の予約は除く） */
const profilePuts = () => commands
    .filter((c) => c.type === "Put" && !String((c.input.Item as Record<string, { S?: string }>)?.userId?.S ?? "").startsWith("username#"))
    .map((c) => c.input);
const usernameDeletes = () => commands
    .filter((c) => c.type === "Delete")
    .map((c) => String((c.input.Key as Record<string, { S?: string }>)?.userId?.S ?? ""));

beforeEach(() => {
    commands.length = 0;
    mockSend.mockReset();
});

describe("同時保存で先の変更が消えない", () => {
    it("競合したら読み直して、自分の変更を最新の上に重ねる", async () => {
        // 1回目の Get: ひとことだけがある状態
        // 1回目の Put: 競合で落ちる
        // 2回目の Get: その間に**別の書き手がピン留めを入れていた**
        // 2回目の Put: 通る
        mockSend
            .mockResolvedValueOnce(profileItem({ statusText: "旅の途中", rev: 3 }))
            .mockImplementationOnce(() => Promise.reject(condFail()))
            .mockResolvedValueOnce(profileItem({ statusText: "旅の途中", pinnedPhotoIds: ["p9"], rev: 4 }))
            .mockResolvedValueOnce({});

        const res = await invoke({ displayName: "新しい名前" });
        expect(res.statusCode).toBe(200);

        const last = profilePuts().at(-1)!;
        const item = last.Item as Record<string, { S?: string; L?: unknown[]; N?: string }>;
        // 自分の変更が入っている
        expect(item.displayName.S).toBe("新しい名前");
        // **他の書き手の変更も残っている**（ここが肝）
        expect(item.pinnedPhotoIds.L).toHaveLength(1);
        expect(item.statusText.S).toBe("旅の途中");
    });

    it("読んだときの rev を条件にして、次の rev を書く", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem({ rev: 7 }))
            .mockResolvedValueOnce({});
        expect((await invoke({ displayName: "旅人2" })).statusCode).toBe(200);

        const put = profilePuts().at(-1)!;
        expect(put.ConditionExpression).toBe("rev = :rev");
        expect((put.ExpressionAttributeValues as Record<string, { N?: string }>)[":rev"].N).toBe("7");
        expect((put.Item as Record<string, { N?: string }>).rev.N).toBe("8");
    });

    it("rev を持たない既存データも書ける（後方互換）", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem({}))   // rev なし
            .mockResolvedValueOnce({});
        expect((await invoke({ displayName: "旅人3" })).statusCode).toBe(200);
        expect(profilePuts().at(-1)!.ConditionExpression).toContain("attribute_not_exists(rev)");
    });

    // 諦めたことを黙って飲み込まない。200 を返すと
    // 「保存しましたと出るのに元どおり」になる。
    it("競合し続けたら 409（成功を装わない）", async () => {
        mockSend.mockImplementation(() =>
            commands[commands.length - 1]?.type === "Put"
                ? Promise.reject(condFail())
                : Promise.resolve(profileItem({ rev: 1 })));
        const res = await invoke({ displayName: "旅人4" });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error).toContain("もう一度");
    });
});

// 部分更新で `{ songStart: 45 }` だけ送ると、songStart のサニタイズが
// `songUrl ? clampSec(...) : undefined` なので undefined に落ち、
// 「addressed かつ undefined = 削除」の規約により**保存済みの再生位置が
// 消えていた**。mergeProfile 側の性質は username.test.ts が固定している。
// こちらは配線（songTouched で apply を絞る）を、ハンドラを実際に呼んで測る。
describe("songUrl を触らない更新は再生位置を消さない", () => {
    const withSong = {
        songUrl: "https://embed.music.apple.com/jp/album/x?i=1",
        songStart: 30, songEnd: 60, rev: 1,
    };

    it("{ songStart } 単体では位置を触らない（曲なしの位置は意味を持たない）", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem(withSong))
            .mockResolvedValueOnce({});
        expect((await invoke({ songStart: 45 })).statusCode).toBe(200);
        const item = profilePuts().at(-1)!.Item as Record<string, { N?: string }>;
        expect(item.songStart?.N).toBe("30");
        expect(item.songEnd?.N).toBe("60");
    });

    it("曲と一緒に送れば位置は書き換わる（正常系を壊していない）", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem(withSong))
            .mockResolvedValueOnce({});
        const res = await invoke({ songUrl: withSong.songUrl, songStart: 45, songEnd: 90 });
        expect(res.statusCode).toBe(200);
        const item = profilePuts().at(-1)!.Item as Record<string, { N?: string }>;
        expect(item.songStart?.N).toBe("45");
        expect(item.songEnd?.N).toBe("90");
    });

    it("{ songUrl, songEnd: 20 } を保存済み songStart=30 と組ませない（E-8）", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem(withSong))
            .mockResolvedValueOnce({});
        expect((await invoke({ songUrl: withSong.songUrl, songEnd: 20 })).statusCode).toBe(200);
        const item = profilePuts().at(-1)!.Item as Record<string, { N?: string }>;
        expect(item.songStart?.N).toBe("30");
        // 終了が開始より前の区間は再生されない死んだ値なので保存しない
        expect(item.songEnd).toBeUndefined();
    });

    it("songUrl を空で送れば位置も一緒に消える（曲を消す回）", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem(withSong))
            .mockResolvedValueOnce({});
        expect((await invoke({ songUrl: "", songStart: 30, songEnd: 60 })).statusCode).toBe(200);
        const item = profilePuts().at(-1)!.Item as Record<string, { N?: string }>;
        expect(item.songUrl).toBeUndefined();
        expect(item.songStart).toBeUndefined();
        expect(item.songEnd).toBeUndefined();
    });
});

// ユーザー名の一意性は本体の保存より先に押さえる（他人に取られないため）。
// そのあと Put が落ちると、以前は `username#<handle>` の予約行だけが残った。
// 本人は付け直せるが、**そこで別の名前を選ぶと誰も取れないまま永久に残る**
// ——releaseUsername は保存済みの旧名しか解放せず、退会の掃除も拾えない。
describe("保存に失敗したらユーザー名の予約を戻す", () => {
    it("本体の書き込みが落ちたら、押さえた名前を解放する", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem({ rev: 1 }))              // getProfile
            .mockResolvedValueOnce({})                                   // reserveUsername
            .mockImplementationOnce(() => Promise.reject(new Error("ddb down")))  // 本体の Put
            .mockResolvedValueOnce({});                                  // releaseUsername
        const res = await invoke({ username: "newname" });
        expect(res.statusCode).toBe(500);
        expect(usernameDeletes()).toContain("username#newname");
    });

    it("競合で諦めたときも解放する", async () => {
        let gets = 0;
        mockSend.mockImplementation(() => {
            const last = commands[commands.length - 1];
            if (last?.type === "Get") { gets++; return Promise.resolve(profileItem({ rev: 1 })); }
            if (last?.type === "Delete") return Promise.resolve({});
            // username# の予約は通し、本体の Put は落とす
            const item = last?.input.Item as Record<string, { S?: string }> | undefined;
            if (String(item?.userId?.S ?? "").startsWith("username#")) return Promise.resolve({});
            return Promise.reject(condFail());
        });
        const res = await invoke({ username: "newname2" });
        expect(res.statusCode).toBe(409);
        expect(usernameDeletes()).toContain("username#newname2");
        expect(gets).toBeGreaterThan(1);   // 読み直している
    });

    it("保存できたときは解放しない（付けた名前が消えない）", async () => {
        mockSend
            .mockResolvedValueOnce(profileItem({ rev: 1 }))
            .mockResolvedValueOnce({})    // reserveUsername
            .mockResolvedValueOnce({});   // 本体の Put
        expect((await invoke({ username: "keepme" })).statusCode).toBe(200);
        expect(usernameDeletes()).not.toContain("username#keepme");
    });
});
