import { describe, it, expect, vi, beforeEach } from "vitest";

// DynamoDB / S3 をモック
const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
    // まとめ消し（`s3Delete.ts`）。**これが無いと本番の失敗を再現しない**
    // ——モックに無い export を読むと vitest が投げるので、削除が全部
    // 「S3 が落ちた」扱いになる
    DeleteObjectsCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));

// 環境変数はモジュール読込時に評価されるため、stub してから動的 import する
// （静的 import はファイル先頭に巻き上げられ stubEnv より先に実行されてしまう）
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const mockIsBlocked = vi.hoisted(() => vi.fn(async () => false));
const mockHidden = vi.hoisted(() => vi.fn(async () => new Set<string>()));
// **ブロックは境界としてモックする**（既定は「していない」）。
// 実際の判定は `block.test.ts` が見る。ここで本物を通すと、
// 全テストのモックに `block#` の分岐を足して回ることになり、
// **本題と関係のない行が増えて読めなくなる**。
// ブロックが効くことは、このファイルの専用のテストで見る。
// `hiddenUserIds` は `blockCheck.ts` へ移した（`follow.ts` から `block.ts` を
// import して輪を作ったため。読むだけの物は1か所に集めた）。
// **全置換にしない。** 「読むだけの物はここに集める」という方針の下では、
// このファイルが新しい読み取りを import した瞬間に、書いていない export が
// **エラーではなく `undefined`** になって静かに壊れる
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: (...a: unknown[]) => mockIsBlocked(...(a as [])),
    blockMarkerId: (a: string, b: string) => `block#${a}#${b}`,
    hiddenUserIds: (...a: unknown[]) => mockHidden(...(a as [])),
}));
// 退会の判定も境界にする。本物は 60秒の控えを持つので、テストの順番で
// 結果が変わる（`notify.ts` に控えを消す口が無い）
const mockDeleted = vi.hoisted(() => vi.fn(async () => new Set<string>()));
vi.mock("../notify", async (importActual) => ({
    ...(await importActual<typeof import("../notify")>()),
    deletedUserIds: () => mockDeleted(),
}));

const { getStories, createStory, deleteStory, viewStory, getStoryViewers, cleanupExpiredStories } = await import("../stories");

type LambdaResult = { statusCode: number; headers?: Record<string, string>; body: string };
// テストでは最小限のイベントだけ渡すため any 経由で呼び出す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (handler: unknown, event: unknown): Promise<LambdaResult> => (handler as any)(event);

function authedEvent(sub: string | undefined, overrides: Record<string, unknown> = {}) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        ...overrides,
    };
}

/** 管理者（`cognito:groups` に admin が入っている） */
function adminEvent(overrides: Record<string, unknown> = {}) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub: "admin-user", "cognito:groups": ["admin"] } } } },
        ...overrides,
    };
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset();
    // **必ず戻す。** 1つのテストで「隠す相手」を差し替えたまま次へ持ち越すと、
    // 関係のないテストがブロック済みの世界で走る
    mockIsBlocked.mockReset().mockResolvedValue(false);
    mockHidden.mockReset().mockResolvedValue(new Set<string>());
    mockDeleted.mockReset().mockResolvedValue(new Set<string>());
});

/**
 * 保存されたストーリー item を順に取り出す。
 * 呼び出し回数の添字で拾うと、間に読み取りが1つ増えるだけで
 * 全部のテストが壊れる（表示名をサーバーで引くようにしたときに実際に壊れた）。
 */
function storyPuts(): Record<string, unknown>[] {
    return mockDdbSend.mock.calls
        .map((c) => (c[0] as { input?: { Item?: Record<string, unknown> } })?.input?.Item)
        .filter((item): item is Record<string, unknown> => !!item && item.story === true);
}

// ────────────────────────────────
// GET /stories
// ────────────────────────────────
/**
 * S3 に消しに行ったキーを平らに並べる。
 *
 * **1件ずつの `DeleteObject` から、まとめての `DeleteObjects` に変えた。**
 * 1行あたり最大8キーを直列に消していたので、「消せなければ行を残す」に
 * したあと、消せない行が溜まると Lambda の実行時間を食い切る
 * （`queryStories` は昇順なので、その行は毎回先頭に来る）。
 * ここで見たいのは**どのキーを消したか**であって、リクエストの数ではない。
 */
const deletedKeys = (): string[] =>
    mockS3Send.mock.calls.flatMap((c) => {
        const input = (c[0] as { input: { Delete?: { Objects?: Array<{ Key: string }> }; Key?: string } }).input;
        return input.Delete?.Objects?.map((o) => o.Key) ?? (input.Key ? [input.Key] : []);
    });

describe("getStories", () => {
    it("未ログイン（sub 欠落）は 401 でストーリーを返さない", async () => {
        const res = await invoke(getStories, authedEvent(undefined));
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("ログイン済みなら作成順で返し、viewers は除外・共有キャッシュもしない", async () => {
        mockDdbSend.mockResolvedValueOnce({
            Items: [
                { id: "s2", createdAt: "2026-07-04T11:00:00Z", viewers: { "u9": { at: "x" } } },
                { id: "s1", createdAt: "2026-07-04T10:00:00Z" },
            ],
        });
        const res = await invoke(getStories, authedEvent("viewer"));
        expect(res.statusCode).toBe(200);
        const items = JSON.parse(res.body) as Array<Record<string, unknown>>;
        expect(items.map((i) => i.id)).toEqual(["s1", "s2"]);
        expect(items.find((i) => i.id === "s2")?.viewers).toBeUndefined();
        expect(res.headers?.["Cache-Control"]).toContain("no-store");
    });

    // **ブロックは両向きに効く。** 自分がブロックした相手のストーリーも、
    // 自分をブロックした相手のストーリーも出さない
    it("ブロックした相手・された相手のストーリーは出さない", async () => {
        mockHidden.mockResolvedValue(new Set(["a", "b"]));
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({});
            return Promise.resolve({ Items: [
                { id: "s1", userId: "me", createdAt: "1" },
                { id: "s2", userId: "a", createdAt: "2" },
                { id: "s3", userId: "b", createdAt: "3" },
                { id: "s4", userId: "c", createdAt: "4" },
            ] });
        });
        const res = await invoke(getStories, authedEvent("me"));
        const ids = (JSON.parse(res.body) as Array<{ id: string }>).map((i) => i.id);
        expect(ids, "ブロックが効いていない").toEqual(["s1", "s4"]);
    });

    // **バッジの数も同じふるいを通す。**
    // `replyCount` は行が持つ「全部の数」で、返信一覧はブロック分を落とす。
    // 揃えないと「返信 1件」を押して「まだ返信はありません」——しかも
    // **ブロックの導線は返信一覧の中にしか無い**ので、
    // 「返信1件 → 読む → ブロック」がいちばん起きる筋で必ずそうなる
    const storiesWithReplies = (replies: Array<{ uid: string }> | "fail") => {
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const key = (cmd.input.Key as { id?: string } | undefined)?.id ?? "";
                if (key.startsWith("storyreplies#")) {
                    return replies === "fail"
                        ? Promise.reject(new Error("throttled"))
                        : Promise.resolve({ Item: { id: key, items: replies } });
                }
                return Promise.resolve({});
            }
            return Promise.resolve({ Items: [{ id: "s1", userId: "me", createdAt: "1", replyCount: 2 }] });
        });
    };
    const badge = async () => (JSON.parse((await invoke(getStories, authedEvent("me"))).body) as Array<{ replyCount?: number }>)[0].replyCount;

    it("ブロックした相手の返信は、バッジの数からも外す", async () => {
        mockHidden.mockResolvedValue(new Set(["blocked"]));
        storiesWithReplies([{ uid: "blocked" }, { uid: "blocked" }]);
        expect(await badge(), "押しても何も無いボタンが残る").toBe(0);
    });

    it("生きている返信は数える", async () => {
        mockHidden.mockResolvedValue(new Set(["blocked"]));
        storiesWithReplies([{ uid: "blocked" }, { uid: "friend" }]);
        expect(await badge()).toBe(1);
    });

    // **読めなければ行の数のまま。** 0 に倒すとバッジが消え、所有者が
    // 届いた返信を読む唯一の入口を失う
    it("返信を読めなければ、行の数のままにする", async () => {
        mockHidden.mockResolvedValue(new Set(["blocked"]));
        storiesWithReplies("fail");
        expect(await badge(), "一時的な失敗でバッジを消している").toBe(2);
    });

    // **ブロックしていない人（ほとんど）は1回も読まない**
    it("誰もブロックしていなければ、返信の文書を読みに行かない", async () => {
        mockHidden.mockResolvedValue(new Set<string>());
        storiesWithReplies([{ uid: "friend" }]);
        expect(await badge()).toBe(2);
        const keys = mockDdbSend.mock.calls
            .map((c) => (c[0].input as { Key?: { id?: string } })?.Key?.id ?? "")
            .filter((k) => k.startsWith("storyreplies#"));
        expect(keys, "ブロックしていないのに返信を読みに行っている").toHaveLength(0);
    });

    // 他人のストーリーの返信数はそもそも返さないので、読みにも行かない
    it("他人のストーリーの返信は読みに行かない", async () => {
        mockHidden.mockResolvedValue(new Set(["blocked"]));
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({});
            return Promise.resolve({ Items: [{ id: "s9", userId: "someone", createdAt: "1", replyCount: 3 }] });
        });
        await invoke(getStories, authedEvent("me"));
        const keys = mockDdbSend.mock.calls
            .map((c) => (c[0].input as { Key?: { id?: string } })?.Key?.id ?? "")
            .filter((k) => k.startsWith("storyreplies#"));
        expect(keys, "他人のストーリーの返信を読んでいる").toHaveLength(0);
    });

    // **見えなくする側が落ちたときに全部消さない**（倒しすぎ）
    it("ブロック一覧を読めなくても、一覧は返す", async () => {
        mockHidden.mockRejectedValue(new Error("boom"));
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({});
            return Promise.resolve({ Items: [{ id: "s1", userId: "me", createdAt: "1" }] });
        });
        const res = await invoke(getStories, authedEvent("me"));
        expect(res.statusCode, "ブロック一覧の失敗で、ストーリーが誰にも出なくなる").toBe(200);
        expect(JSON.parse(res.body)).toHaveLength(1);
    });

    // **返信の数は投稿者にだけ。** 誰が反応したかは `viewers` と同じく
    // 本人だけのもので、見た人に「このストーリーに何件届いたか」を教えない
    it("replyCount は投稿者にだけ返す", async () => {
        mockDdbSend.mockResolvedValueOnce({
            Items: [
                { id: "s1", userId: "me", createdAt: "2026-07-04T10:00:00Z", replyCount: 3 },
                { id: "s2", userId: "other", createdAt: "2026-07-04T11:00:00Z", replyCount: 7 },
            ],
        });
        const res = await invoke(getStories, authedEvent("me"));
        const items = JSON.parse(res.body) as Array<{ id: string; replyCount?: number }>;
        expect(items.find((i) => i.id === "s1")?.replyCount, "自分の分まで消している").toBe(3);
        expect(items.find((i) => i.id === "s2")?.replyCount, "他人に返信の数を教えている").toBeUndefined();
    });

    // 「残した」印も本人だけ（`viewers` と同じ扱い）
    it("keptAs も投稿者にだけ返す", async () => {
        mockDdbSend.mockResolvedValueOnce({
            Items: [
                { id: "s1", userId: "me", createdAt: "1", keptAs: "p-1" },
                { id: "s2", userId: "other", createdAt: "2", keptAs: "p-2" },
            ],
        });
        const res = await invoke(getStories, authedEvent("me"));
        const items = JSON.parse(res.body) as Array<{ id: string; keptAs?: string }>;
        expect(items.find((i) => i.id === "s1")?.keptAs, "自分の分まで消している").toBe("p-1");
        expect(items.find((i) => i.id === "s2")?.keptAs, "他人に「残した」印を返している").toBeUndefined();
    });

    it("ページネーション（LastEvaluatedKey）を辿って全件返す", async () => {
        // 種類で答える（上と同じ理由。GetItem と並行になった）
        let page = 0;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({});
            page++;
            return Promise.resolve(page === 1
                ? { Items: [{ id: "a", createdAt: "1" }], LastEvaluatedKey: { id: "a" } }
                : { Items: [{ id: "b", createdAt: "2" }] });
        });
        const res = await invoke(getStories, authedEvent("viewer"));
        const items = JSON.parse(res.body) as Array<Record<string, unknown>>;
        expect(items).toHaveLength(2);
        // Query が2回（ページを辿る）。**GetItem の数は数えない**
        // ——ブロックの一覧（`blocks#` / `blockedby#`）を読むぶんが増えるので、
        // 総数で縛ると関係のない変更で落ちる
        const queries = mockDdbSend.mock.calls
            .filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "QueryCommand");
        expect(queries, "ページを辿っていない").toHaveLength(2);
    });

    it("DynamoDB エラーは 500", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(getStories, authedEvent("viewer"));
        expect(res.statusCode).toBe(500);
    });

    it("Scan ではなく専用の索引を Query する", async () => {
        // 以前はテーブル全体の Scan だった。写真もコメント文書も
        // いいね/フォローのマーカー（退会しても消えない）も同居しているので、
        // 増えるほど遅くなり、いずれ実行時間を超えて
        // 「ログイン中の全員のストーリー欄が同時に壊れる」。
        mockDdbSend.mockResolvedValueOnce({ Items: [] });
        await invoke(getStories, authedEvent("viewer"));
        const input = mockDdbSend.mock.calls[0][0].input as {
            IndexName?: string; KeyConditionExpression?: string; FilterExpression?: string;
        };
        expect(input.IndexName).toBe("storyFeed-expiresAt-index");
        expect(input.KeyConditionExpression).toContain("storyFeed = :k");
        expect(input.KeyConditionExpression).toContain("expiresAt > :now");
        expect(input.FilterExpression).toBeUndefined();
    });

    it("索引がまだ無いテーブルでは Scan に落ちる（機能ごと止めない）", async () => {
        // 索引を足すのはデプロイとは別作業なので、順序が前後しても
        // ストーリーが見えなくならないようにする。
        // **順番ではなくコマンドの種類で答える。** ブロックの一覧（GetItem）は
        // ストーリーの取得と**並行**に投げるので、`mockResolvedValueOnce` を
        // 積む書き方だと取り違える（並行にした時点で実際に落ちた）
        const missing = Object.assign(new Error("index not found"), { name: "ValidationException" });
        let queried = false;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({});
            if (cmd.constructor.name === "QueryCommand" && !queried) { queried = true; return Promise.reject(missing); }
            return Promise.resolve({ Items: [{ id: "s1", createdAt: "1" }] });
        });
        const res = await invoke(getStories, authedEvent("viewer"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toHaveLength(1);
        const scan = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: { FilterExpression?: string } })
            .find((c) => c.constructor.name === "ScanCommand");
        expect(scan, "Scan に落ちていない").toBeTruthy();
        expect(scan!.input.FilterExpression).toContain("story = :t");
    });
});

// ────────────────────────────────
// POST /stories
// ────────────────────────────────
describe("createStory", () => {
    it("認証なし（sub 欠落）は 401", async () => {
        const res = await invoke(createStory, authedEvent(undefined, { body: "{}" }));
        expect(res.statusCode).toBe(401);
    });

    it("publicUrl なしは 400", async () => {
        const res = await invoke(createStory, authedEvent("u1", { body: JSON.stringify({}) }));
        expect(res.statusCode).toBe(400);
    });

    it("配信ドメイン外の publicUrl は 400", async () => {
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://evil.example.com/x.jpg" }),
        }));
        expect(res.statusCode).toBe(400);
    });

    it("他人の領域を指す publicUrl は 400", async () => {
        // uploads/ 配下かどうかしか見ていなかった頃は、他人の写真のURLを
        // 自分のストーリーとして登録し、削除するだけで相手のファイルを消せた。
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u2/victim.jpg" }),
        }));
        expect(res.statusCode).toBe(400);
    });

    it("クライアントが送った key は使わず、publicUrl から導く", async () => {
        // key をそのまま信じていた頃は、自分の正当な publicUrl と一緒に
        // 他人のキーを送るだけで、削除時にそのファイルが消えた。
        mockDdbSend.mockResolvedValueOnce({ Count: 0 }).mockResolvedValueOnce({});
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({
                publicUrl: "https://cdn.test/uploads/u1/a.jpg",
                key: "uploads/u2/victim.jpg",
            }),
        }));
        expect(res.statusCode).toBe(201);
        expect(storyPuts()[0].key).toBe("uploads/u1/a.jpg");
    });

    // 投稿は「本数カウントの Query → Put」の順に DynamoDB を呼ぶ
    it("正常系: story=true / published=false / 24時間の期限付きで保存される", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Count: 0 }) // 本日の投稿数
            .mockResolvedValueOnce({}); // Put
        const before = Date.now();
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({
                publicUrl: "https://cdn.test/uploads/u1/a.jpg",
                caption: "  旅の思い出  ",
                displayName: "旅人",
            }),
        }));
        expect(res.statusCode).toBe(201);
        const item = storyPuts()[0];
        expect(item.story).toBe(true);
        expect(item.published).toBe(false);
        expect(item.userId).toBe("u1");
        expect(item.mediaType).toBe("image");
        expect(item.caption).toBe("旅の思い出");
        expect(item.key).toBe("uploads/u1/a.jpg");
        // 一覧用の索引に載せるための定数。これが無いと Query に出てこない
        expect(item.storyFeed).toBe("1");
        expect(String(item.id)).toMatch(/^story-/);
        const ttl = Date.parse(String(item.expiresAt)) - Date.parse(String(item.createdAt));
        expect(ttl).toBe(24 * 60 * 60 * 1000);
        expect(Date.parse(String(item.createdAt))).toBeGreaterThanOrEqual(before - 1000);
    });

    it("mediaType=video が保存される（不正値は image に落ちる）", async () => {
        mockDdbSend.mockResolvedValue({}); // Query({Count:undefined→0}) と Put の両方に効く
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/v.mp4", mediaType: "video" }),
        }));
        let item = storyPuts()[0];
        expect(item.mediaType).toBe("video");

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/x.jpg", mediaType: "gif" }),
        }));
        item = storyPuts()[1];
        expect(item.mediaType).toBe("image");
    });

    // ストーリーはログイン中の全員のトレイに並ぶ。表示名をクライアントに
    // 決めさせると「Journey 運営」のような名前でそのまま全員に届く。
    it("表示名はサーバーで引く（クライアントの申告は使わない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Count: 0 })                              // 本日の投稿数
            .mockResolvedValueOnce({ Item: { displayName: "本物の名前" } })     // 表示名の解決
            .mockResolvedValueOnce({});                                       // Put
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({
                publicUrl: "https://cdn.test/uploads/u1/a.jpg",
                displayName: "Journey 運営",
            }),
        }));
        expect(storyPuts()[0].displayName).toBe("本物の名前");
    });

    it("キャプションは200文字に切り詰められる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Count: 0 }).mockResolvedValueOnce({});
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg", caption: "あ".repeat(300) }),
        }));
        const item = storyPuts()[0];
        expect(String(item.caption)).toHaveLength(200);
    });

    it("表示秒数は3〜15秒に丸め、既定の5秒なら保存しない", async () => {
        mockDdbSend.mockResolvedValue({});
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg", durationSec: 10 }),
        }));
        expect(storyPuts()[0].durationSec).toBe(10);

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg", durationSec: 999 }),
        }));
        expect(storyPuts()[1].durationSec).toBe(15);

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg", durationSec: 5 }),
        }));
        expect(storyPuts()[2].durationSec).toBeUndefined();
    });

    it("外部ホストの音源URLは保存しない（曲ごと落とす）", async () => {
        // ストーリーはログイン中の全員のトレイに出るので、任意のURLを
        // 1回仕込むだけで利用者ほぼ全員の IP・User-Agent・時刻を集められた。
        mockDdbSend.mockResolvedValueOnce({ Count: 0 }).mockResolvedValueOnce({});
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({
                publicUrl: "https://cdn.test/uploads/u1/a.jpg",
                song: { title: "Song", previewUrl: "https://attacker.tld/beacon.mp3" },
            }),
        }));
        expect(storyPuts()[0].song).toBeUndefined();
    });

    it("曲の開始位置（好きな部分）は0〜29秒に丸めて保存する", async () => {
        mockDdbSend.mockResolvedValue({});
        // 音源は Apple のホストのみ受け付ける（外部URLは開いた人のIPを集められる）
        const song = { title: "Song", previewUrl: "https://audio-ssl.itunes.apple.com/p.m4a" };
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg", song: { ...song, startSec: 12.4 } }),
        }));
        let item = storyPuts()[0];
        expect((item.song as { startSec?: number }).startSec).toBe(12);

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg", song: { ...song, startSec: 120 } }),
        }));
        item = storyPuts()[1];
        expect((item.song as { startSec?: number }).startSec).toBe(29);
    });

    it("24時間の投稿上限に達していたら 429 で保存しない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Count: 20 }); // 上限ちょうど
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg" }),
        }));
        expect(res.statusCode).toBe(429);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Query のみ、Put なし
    });

    // 以前は「数え上げ失敗は投稿を止めない」だった（fail-open）。
    // スロットリングを起こせば1日上限を素通りできる。写真の100枚制限
    // （upload.ts の photoLimitError）は「数えられなければ 503」に
    // 倒してあり、こちらだけ逆向きだったので揃えた。
    // putPhoto と同じ作法。条件が無いと、同じIDの既存文書（notifs#… /
    // comments#…）を丸ごと置き換えられる。ID は story-<UUID> なので衝突は
    // 現実には起きないが、1か所だけ緩いと次に書く人がそちらを手本にする。
    it("作成は新規専用（既存の文書を置き換えない条件が付く）", async () => {
        mockDdbSend.mockResolvedValue({ Items: [], Count: 0 });
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg" }),
        }));
        expect(res.statusCode).toBe(201);
        const put = mockDdbSend.mock.calls
            .map((c: unknown[]) => c[0] as { constructor: { name: string }; input: { ConditionExpression?: string } })
            .find((cmd) => cmd?.constructor?.name === "PutCommand")!;
        expect(put.input.ConditionExpression).toBe("attribute_not_exists(id)");
    });

    it("投稿数を数えられなければ 503 で断る（保存しない）", async () => {
        // Query だけを落とす。呼び出し順のキューだと、モックの並びが
        // 実装とずれた回に別の理由で通る（実際にそうなっていた）。
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd?.constructor?.name === "QueryCommand") return Promise.reject(new Error("query down"));
            return Promise.resolve({});
        });
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.jpg" }),
        }));
        expect(res.statusCode).toBe(503);
        // 保存もしていない
        const puts = mockDdbSend.mock.calls.filter(
            (c: unknown[]) => (c[0] as { constructor: { name: string } })?.constructor?.name === "PutCommand");
        expect(puts).toHaveLength(0);
    });
});

// **ストーリーにも撮影地を持たせる。** 見る側に「どこで」が伝わるだけでなく、
// **ギャラリーに残したときにそのまま写真の撮影地になる**（`storyKeep.ts`）
// ——このサイトの価値は 撮影地 → 地図 → `/location/<スラッグ>` → 検索流入 なので、
// ここが空だと残しても本人が手で打つまで何にも繋がらない。
describe("createStory: 撮影地", () => {
    const post = (body: Record<string, unknown>) => invoke(createStory, authedEvent("u1", {
        body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.webp", ...body }),
    }));
    /** 保存された行 */
    const saved = () => (mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: { Item?: Record<string, unknown> } })
        .find((c) => c.constructor.name === "PutCommand")?.input.Item) ?? {};

    it("地名と座標を保存する", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ location: "横浜 みなとみらい", coords: { lat: 35.4567, lng: 139.6321 } });
        expect(saved().location).toBe("横浜 みなとみらい");
        // **約1kmに丸めたものだけを保存する**（生の緯度経度を公開URLに載せない）
        expect(saved().coords).toEqual({ lat: 35.46, lng: 139.63 });
    });

    // 地名の無い座標は画面に出しようがなく、残しても「名前の無い点」が増えるだけ
    it("地名が無ければ座標も持たない", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ coords: { lat: 35.45, lng: 139.63 } });
        expect("coords" in saved(), "地名の無い座標を保存している").toBe(false);
    });

    it("壊れた座標は捨てる（地名は残す）", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ location: "どこか", coords: { lat: 999, lng: "x" } });
        expect(saved().location).toBe("どこか");
        expect("coords" in saved(), "範囲外の座標を保存している").toBe(false);
    });

    // **動画には位置を付けない。** 位置は写真の EXIF から来るもので、動画は
    // `toUploadSafeVideo` が GPS を落としている。画面側の1か所だけで守ると、
    // 細工した要求で動画に座標を付けられる（片側だけの防御を作らない）
    it("動画のストーリーには位置を付けない", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ mediaType: "video", location: "横浜", coords: { lat: 35.45, lng: 139.63 } });
        expect("location" in saved(), "動画に撮影地を付けている").toBe(false);
        expect("coords" in saved(), "動画に座標を付けている").toBe(false);
    });

    // **検証は写真と同じものを通す**（`sanitizeText`）と書いていたのに、
    // それを外しても全58件が緑だった＝**1本も守っていなかった**。
    // ここが素通しだと、改行入り・長大な地名がそのまま保存され、
    // `keepStory` 経由で写真の `location` → `/location/<スラッグ>`・
    // `<title>`・JSON-LD に入る（スラッグはファイル名にもなる）
    it("制御文字を落とす", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ location: `横浜${String.fromCharCode(10)}みなとみらい${String.fromCharCode(0)}` });
        // `sanitizeText` は落とす（区切りに寄せない）。実際の振る舞いで固定する
        expect(saved().location, "改行や NUL がそのまま保存されている").toBe("横浜みなとみらい");
    });

    it("200文字で切る", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ location: "あ".repeat(300) });
        expect(String(saved().location).length, "上限が効いていない").toBe(200);
    });

    it("空白だけなら持たない", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ location: "   " });
        expect("location" in saved()).toBe(false);
    });

    it("文字列でない地名は持たない", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({ location: { ja: "横浜" } });
        expect("location" in saved(), "オブジェクトを地名として保存している").toBe(false);
    });

    it("場所を送らなければ、項目ごと持たない", async () => {
        mockDdbSend.mockResolvedValue({ Count: 0 });
        await post({});
        expect("location" in saved()).toBe(false);
    });
});

// ────────────────────────────────
// DELETE /stories/{id}
// ────────────────────────────────
describe("deleteStory", () => {
    it("id なしは 400", async () => {
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: undefined }));
        expect(res.statusCode).toBe(400);
    });

    it("存在しない / ストーリーでないものは 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-x" } }));
        expect(res.statusCode).toBe(404);
    });

    it("投稿者以外は 403（他人のストーリーは消せない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } });
        const res = await invoke(deleteStory, authedEvent("attacker", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(403);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("投稿者本人は DDB レコードと S3 オブジェクトを削除できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg" } }) // Get
            .mockResolvedValueOnce({}); // Delete
        mockS3Send.mockResolvedValueOnce({});
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        expect(deletedKeys()).toEqual(["uploads/a.jpg"]);
    });

    // **ここは向きを変えた。** 以前は「S3 削除に失敗しても DDB レコードは
    // 削除する」を固定していたが、それだと行（＝S3 キーの唯一の手がかり）が
    // 消えて、**GPS 入りの動画がどの削除経路からも辿れない**孤児になる。
    // 写真の3経路（`deleteMyPhoto`・`deleteAccount`・管理の `deletePhoto`）は
    // 全部「消せなければ行を残す」で、理由もそこに書いてある。
    // ストーリーだけ逆だった。
    it("S3 削除に失敗したら、行を残して 500 を返す（孤児を作らない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg" } });
        mockS3Send.mockRejectedValueOnce(new Error("s3 down"));
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(500);
        // 押し直せば続きから消える、と読める文言を返す
        expect(JSON.parse(res.body).error).toContain("もう一度");
        // **行を消していない**（ここが要点。消すと二度と辿れない）
        const deletes = mockDdbSend.mock.calls.filter(
            (c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(deletes, "S3 が消せていないのに行を消した").toHaveLength(0);
    });

    // **手がかりを残すのは「失敗したら行を消さない」の方。**
    // `storyreplies#<id>` は `storyFeed` も `story` も `src` も持たないので、
    // 行が消えると GSI にも Scan にも一覧にも出ない＝二度と辿れない
    it("返信を消せなかったら、行を残して失敗を返す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg" } });
            }
            if (id.startsWith("storyreplies#")) return Promise.reject(new Error("boom"));
            return Promise.resolve({});
        });
        mockS3Send.mockResolvedValue({});
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode, "返信を消せていないのに成功と言っている").toBe(500);
        const rowDeleted = mockDdbSend.mock.calls.some((c) => {
            const cmd = c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } };
            return cmd.constructor.name === "DeleteCommand" && cmd.input.Key?.id === "story-1";
        });
        expect(rowDeleted, "辿る手がかり（行）まで消している").toBe(false);
    });

    // 票の文書も同じ——消せなければ行を残す（`storyvotes#<id>` も
    // `storyFeed` を持たないので、行が消えると二度と辿れない）
    it("票の文書を消せなかったら、行を残して失敗を返す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg" } });
            }
            if (id.startsWith("storyvotes#")) return Promise.reject(new Error("boom"));
            return Promise.resolve({});
        });
        mockS3Send.mockResolvedValue({});
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode, "票を消せていないのに成功と言っている").toBe(500);
        const rowDeleted = mockDdbSend.mock.calls.some((c) => {
            const cmd = c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } };
            return cmd.constructor.name === "DeleteCommand" && cmd.input.Key?.id === "story-1";
        });
        expect(rowDeleted, "辿る手がかり（行）まで消している").toBe(false);
    });

    // **ギャラリーに残した1枚の実体は消さない。** `keptAs` が立っている
    // ストーリーは、その S3 オブジェクトの持ち主が写真の行に移っている。
    // ここで消すと、残したはずの写真が**割れた画像**になる（行は残るので
    // 一覧にも個別ページにも壊れた枠が並ぶ）。行だけ消す＝24時間の約束は守る
    it("ギャラリーに残した写真の実体は消さない（行だけ消す）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg", keptAs: "photo-1" } })
            .mockResolvedValue({});
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        expect(mockS3Send, "残した写真の実体まで消している").not.toHaveBeenCalled();
        const keys = mockDdbSend.mock.calls
            .filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand")
            .map((c) => (c[0] as { input: { Key: { id: string } } }).input.Key.id);
        expect(keys, "行は予定どおり消す").toEqual(["storyreplies#story-1", "storyvotes#story-1", "story-1", "storyvotes#story-1"]);
    });

    // **ここで写真を消してはいけない。**
    //
    // 一度は「管理者なら残された写真ごと消す」と書いたが、消し方が
    // 足りていなかった——派生画像（`thumbAvif` / `thumbSm` /
    // `thumbSmAvif` / `srcAvif` / `src256`）は `generate-thumbnails.js` が
    // **写真の行**に書き戻すので、`storyMediaKeys`（ストーリーの行しか
    // 見ない）では1つも消えない。行を消したあとは**どの経路からも
    // 辿れない孤児**になる。`comments#` もピンの枠も静的HTMLも残る。
    // 管理APIの写真削除がその全部をやったうえでストーリーまで消すので、
    // **そちらへ送る**（同じものを二度作らない）。
    it("管理者でも、ギャラリーに残された写真は消さずに 409 で断る", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "someone", key: "uploads/a.jpg", keptAs: "photo-1" } })
            .mockResolvedValueOnce({ Item: { id: "photo-1", src: "https://cdn/uploads/a.jpg" } })  // 残された写真は実在する
            .mockResolvedValue({});
        mockS3Send.mockResolvedValue({});
        const res = await invoke(deleteStory, adminEvent({ pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error, "どうすればよいか言っていない").toContain("の方を削除してください");
        // どの写真かを言わないと、管理画面（下書きも並ぶ）から人手で探すことになり、
        // その間ずっとストーリーは全員のトレイに残る（最大24時間）
        expect(JSON.parse(res.body).error, "どの写真か分からない").toContain("photo-1");
        const deleted = mockDdbSend.mock.calls
            .filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand")
            .map((c) => (c[0] as { input: { Key: { id: string } } }).input.Key.id);
        expect(deleted, "中途半端に消している").toEqual([]);
        expect(mockS3Send, "実体だけ消すと割れた写真が残る").not.toHaveBeenCalled();
    });

    // 断りっぱなしにすると、印が死んだIDを指している場合に
    // **管理者が何もできなくなる**。実在を確かめてから断る
    it("残された写真がもう無ければ、普通に消せる（実体も消す）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "someone", key: "uploads/a.jpg", keptAs: "photo-1" } })
            .mockResolvedValueOnce({})   // 写真の行はもう無い
            .mockResolvedValue({});
        mockS3Send.mockResolvedValue({});
        const res = await invoke(deleteStory, adminEvent({ pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        expect(mockS3Send, "持ち主の居ない実体が公開URLに残る").toHaveBeenCalled();
        const deleted = mockDdbSend.mock.calls
            .filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand")
            .map((c) => (c[0] as { input: { Key: { id: string } } }).input.Key.id);
        expect(deleted).toEqual(["storyreplies#story-1", "storyvotes#story-1", "story-1", "storyvotes#story-1"]);
    });

    // 本人が消すときは今までどおり（残した写真は守る）
    it("本人が消すときは、残された写真の実体を守る", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg", keptAs: "photo-1" } })
            .mockResolvedValue({});
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        expect(mockS3Send, "本人が残した写真の実体まで消している").not.toHaveBeenCalled();
    });

    it("S3 が消せていれば、これまでどおり行も消す（正常系）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg" } })
            .mockResolvedValueOnce({});
        mockS3Send.mockResolvedValueOnce({});
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        const deletes = mockDdbSend.mock.calls.filter(
            (c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        // 行と、そこに届いた返信の文書。**返信を先に消す**
        // （逆だと、消し損ねた `storyreplies#` を辿る手がかりが無くなる）
        const keys = deletes.map((c) => (c[0] as { input: { Key: { id: string } } }).input.Key.id);
        // 票の文書（`storyvotes#`）も同じ理由で行より先に。**行のあとにもう一度**
        // ——文書 → 行 の間に通った票は、行がまだ在るので `voteStory` の
        // ConditionCheck を満たして文書を作り直す。行が消えたあとは作れない
        expect(keys, "返信・票の文書を消していない（24時間で消える約束のものが残る）")
            .toEqual(["storyreplies#story-1", "storyvotes#story-1", "story-1", "storyvotes#story-1"]);
    });

    // 以前はサムネ生成スクリプトがストーリーも対象にしていたため、
    // 派生画像（AVIF・小サイズ）が max-age=31536000 で残っている個体がある。
    // 原本だけ消すと、24時間で消えるはずのものが公開URLで取得できてしまう。
    it("派生画像も残さず消す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({
                Item: {
                    id: "story-1", story: true, userId: "u1",
                    key: "uploads/a.jpg",
                    src: "https://cdn.example.com/uploads/a.jpg",
                    srcOriginal: "https://cdn.example.com/uploads/a_orig.jpg",
                    srcAvif: "https://cdn.example.com/uploads/a_lg.avif",
                    thumbSrc: "https://cdn.example.com/uploads/a_thumb.webp",
                    thumbAvif: "https://cdn.example.com/uploads/a_thumb.avif",
                    thumbSm: "https://cdn.example.com/uploads/a_thumb_sm.webp",
                    thumbSmAvif: "https://cdn.example.com/uploads/a_thumb_sm.avif",
                },
            })
            .mockResolvedValueOnce({});
        mockS3Send.mockResolvedValue({});

        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);

        const deleted = deletedKeys();
        expect(deleted).toEqual(expect.arrayContaining([
            "uploads/a.jpg", "uploads/a_orig.jpg", "uploads/a_lg.avif",
            "uploads/a_thumb.webp", "uploads/a_thumb.avif",
            "uploads/a_thumb_sm.webp", "uploads/a_thumb_sm.avif",
        ]));
        // key と src は同じオブジェクトなので重複して消さない
        expect(new Set(deleted).size).toBe(deleted.length);
    });
});

// ────────────────────────────────
// POST /stories/{id}/view
// ────────────────────────────────
describe("viewStory", () => {
    it("id なしは 400", async () => {
        const res = await invoke(viewStory, authedEvent("u1", { body: "{}" }));
        expect(res.statusCode).toBe(400);
    });

    it("存在しない / ストーリーでないレコードは 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        let res = await invoke(viewStory, authedEvent("u1", { pathParameters: { id: "story-x" }, body: "{}" }));
        expect(res.statusCode).toBe(404);

        mockDdbSend.mockResolvedValueOnce({ Item: { id: "photo-1", story: undefined } });
        res = await invoke(viewStory, authedEvent("u1", { pathParameters: { id: "photo-1" }, body: "{}" }));
        expect(res.statusCode).toBe(404);
    });

    // **期限切れは「もう無い」。** 行が残っているのは掃除が日次だからで、
    // 一覧はとっくに返していない。記録すると、消えたはずのストーリーに
    // 閲覧者があとから増える（本人にはそれが見える）。
    it("期限切れのストーリーは記録しない（404）", async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        mockDdbSend.mockResolvedValueOnce({
            Item: { id: "story-1", story: true, userId: "owner", expiresAt: past },
        });
        const res = await invoke(viewStory, authedEvent("viewer-1", { pathParameters: { id: "story-1" }, body: "{}" }));

        expect(res.statusCode).toBe(404);
        expect(mockDdbSend, "期限切れなのに書き込んでいる").toHaveBeenCalledTimes(1);   // Get だけ
    });

    it("期限内なら今までどおり記録する", async () => {
        const future = new Date(Date.now() + 60_000).toISOString();
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner", expiresAt: future } })
            .mockResolvedValueOnce({ Item: { displayName: "旅子" } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        const res = await invoke(viewStory, authedEvent("viewer-1", { pathParameters: { id: "story-1" }, body: "{}" }));

        expect(res.statusCode).toBe(200);
        expect(mockDdbSend.mock.calls
            .filter((c) => (c[0] as { constructor: { name: string } })?.constructor?.name === "UpdateCommand"))
            .toHaveLength(2);
    });

    // `expiresAt` を持たない古い行を、無い理由で締め出さない
    it("expiresAt が無い行は有効として扱う", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } })
            .mockResolvedValueOnce({ Item: { displayName: "旅子" } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        const res = await invoke(viewStory, authedEvent("viewer-1", { pathParameters: { id: "story-1" }, body: "{}" }));
        expect(res.statusCode).toBe(200);
    });

    it("本人の閲覧は記録しない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1" } });
        const res = await invoke(viewStory, authedEvent("u1", { pathParameters: { id: "story-1" }, body: "{}" }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).self).toBe(true);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Get のみ、Update なし
    });

    // DynamoDB の UpdateItem はキーが無ければ**作る**。条件を付けないと、
    // 「見たよ」の報告が削除と競合したときに、消えたはずのストーリーIDで
    // 新しい行ができる。その行は story も src も userId も storyFeed も
    // 持たないので、期限切れ掃除・退会削除・写真一覧のどれからも辿れない
    // ＝誰にも消せないゴミが残り、消したストーリーの閲覧者名も残る。
    it("記録の書き込みには存在チェックを付ける（消えた行を作らない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } })
            .mockResolvedValueOnce({ Item: { displayName: "本当の名前" } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(viewStory, authedEvent("viewer-1", { pathParameters: { id: "story-1" }, body: "{}" }));

        const updates = mockDdbSend.mock.calls
            .map((c) => c[0])
            .filter((cmd) => cmd?.constructor?.name === "UpdateCommand");
        expect(updates).toHaveLength(2);
        for (const u of updates) {
            expect(u.input.ConditionExpression).toBe("attribute_exists(id) AND attribute_not_exists(archivedAt)");
        }
    });

    it("読んだあとに消されていたら 404（記録しない）", async () => {
        const cond = Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } })
            .mockResolvedValueOnce({ Item: { displayName: "本当の名前" } })
            .mockRejectedValueOnce(cond);
        const res = await invoke(viewStory, authedEvent("viewer-1", { pathParameters: { id: "story-1" }, body: "{}" }));
        expect(res.statusCode).toBe(404);
    });

    // **ブロックした相手の閲覧は記録しない。** 一覧からは隠しているが、
    // 期限をまたいで開きっぱなしのタブや直接叩く経路ではここに来る。
    // 記録すると、所有者の閲覧者一覧に**相手が付けた任意の表示名**が出る
    it("ブロックした相手の閲覧は記録しない（404）", async () => {
        mockIsBlocked.mockResolvedValue(true);
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "s1", story: true, userId: "owner", expiresAt: "2099-01-01T00:00:00Z" } });
        const res = await invoke(viewStory, authedEvent("them", { pathParameters: { id: "s1" } }));
        expect(res.statusCode).toBe(404);
        const writes = mockDdbSend.mock.calls
            .filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "UpdateCommand");
        expect(writes, "ブロックした相手を閲覧者に記録している").toHaveLength(0);
    });

    it("他人の閲覧は viewers マップに初回時刻つきで記録する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } })
            .mockResolvedValueOnce({ Item: { displayName: "本当の名前" } }) // 表示名をテーブルから引く
            .mockResolvedValueOnce({}) // viewers マップ初期化
            .mockResolvedValueOnce({}); // 閲覧者エントリ追加
        const res = await invoke(viewStory, authedEvent("viewer-1", {
            pathParameters: { id: "story-1" },
            body: JSON.stringify({ displayName: "なりすまし" }),
        }));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(4);
        const initExpr = (mockDdbSend.mock.calls[2][0] as { input: { UpdateExpression: string } }).input.UpdateExpression;
        expect(initExpr).toContain("if_not_exists(viewers");
        const addCall = (mockDdbSend.mock.calls[3][0] as {
            input: {
                UpdateExpression: string;
                ExpressionAttributeNames: Record<string, string>;
                ExpressionAttributeValues: Record<string, { displayName?: string }>;
            };
        }).input;
        expect(addCall.ExpressionAttributeNames["#uid"]).toBe("viewer-1");
        expect(addCall.UpdateExpression).toContain("if_not_exists(viewers.#uid"); // 初回閲覧時刻を上書きしない
        // 名前はテーブルから引いた値を使う。リクエストの申告は無視する
        // （改造したクライアントから任意の名前で閲覧履歴に載れないように）
        expect(addCall.ExpressionAttributeValues[":v"].displayName).toBe("本当の名前");
    });
});

// ────────────────────────────────
// GET /stories/{id}/viewers
// ────────────────────────────────
describe("getStoryViewers", () => {
    it("投稿者以外は 403", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } });
        const res = await invoke(getStoryViewers, authedEvent("stranger", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(403);
    });

    it("投稿者本人には閲覧時刻の新しい順でリストを返す", async () => {
        mockDdbSend.mockResolvedValueOnce({
            Item: {
                id: "story-1", story: true, userId: "owner",
                viewers: {
                    "u-a": { displayName: "A", at: "2026-07-04T10:00:00Z" },
                    "u-b": { displayName: "B", at: "2026-07-04T11:00:00Z" },
                },
            },
        });
        const res = await invoke(getStoryViewers, authedEvent("owner", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { viewers: Array<{ userId: string }>; count: number };
        expect(body.count).toBe(2);
        expect(body.viewers.map((v) => v.userId)).toEqual(["u-b", "u-a"]);
    });

    it("viewers 未設定なら空リスト", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } });
        const res = await invoke(getStoryViewers, authedEvent("owner", { pathParameters: { id: "story-1" } }));
        expect(JSON.parse(res.body)).toEqual({ viewers: [], count: 0 });
        expect(mockDeleted, "閲覧者が居ないのに退会者を引きに行っている").not.toHaveBeenCalled();
    });

    // **表示名は閲覧のときに焼き込む**（`viewStory`）ので、そのあと
    // 退会しても残る。「誰が何をしたか」を返す一覧6本のうち、
    // ここだけ `deletedUserIds()` を通していなかった
    it("退会した人の名前は出さない", async () => {
        mockDeleted.mockResolvedValue(new Set(["u-b"]));
        mockDdbSend.mockResolvedValueOnce({
            Item: {
                id: "story-1", story: true, userId: "owner",
                viewers: {
                    "u-a": { displayName: "A", at: "2026-07-04T10:00:00Z" },
                    "u-b": { displayName: "退会前の名前", at: "2026-07-04T11:00:00Z" },
                },
            },
        });
        const res = await invoke(getStoryViewers, authedEvent("owner", { pathParameters: { id: "story-1" } }));
        const body = JSON.parse(res.body) as { viewers: Array<{ userId: string; displayName?: string; deleted?: boolean }> };
        const gone = body.viewers.find((v) => v.userId === "u-b")!;
        expect(gone.displayName, "退会した人の名前が残っている").toBe("退会したユーザー");
        expect(gone.deleted).toBe(true);
        // 退会していない人はそのまま
        expect(body.viewers.find((v) => v.userId === "u-a")?.displayName).toBe("A");
    });

    // **ブロックした相手は一覧に出さない（両向き）。**
    // 閲覧の記録は `viewStory` の時点で焼き込まれる。`viewStory` が断るのは
    // これからのぶんだけなので、ブロック前に見られたぶんは名前も `userId` も
    // 付いたまま残っていた（通知で直したのと同じ型）。
    const seen = {
        "u-a": { displayName: "A", at: "2026-07-04T10:00:00Z" },
        "u-b": { displayName: "B", at: "2026-07-04T11:00:00Z" },
    };
    const withViewers = (viewers: Record<string, unknown>) => {
        mockDdbSend.mockReset().mockResolvedValue({ Item: { id: "story-1", story: true, userId: "owner", viewers } });
    };
    const call = async () => JSON.parse(
        (await invoke(getStoryViewers, authedEvent("owner", { pathParameters: { id: "story-1" } }))).body,
    ) as { viewers: Array<{ userId: string }>; count: number };

    it("ブロックした相手は閲覧者に出さない", async () => {
        withViewers(seen);
        mockHidden.mockResolvedValue(new Set(["u-b"]));
        const body = await call();
        expect(body.viewers.map((v) => v.userId), "ブロックした相手が閲覧者に残っている").toEqual(["u-a"]);
        // **数はこの一覧から導く**（食い違わせない）
        expect(body.count).toBe(1);
        // 和集合を引いているか（両向きに効くのはこの関数の性質）
        expect(mockHidden).toHaveBeenCalledWith("owner");
    });

    it("ブロックしていなければ誰も落とさない", async () => {
        withViewers(seen);
        mockHidden.mockResolvedValue(new Set<string>());
        const body = await call();
        expect(body.count).toBe(2);
    });

    // 見えなくする側が落ちたときに全部消さない（`getStories` と同じ判断）
    it("ブロック一覧を読めなくても、閲覧者は返す", async () => {
        withViewers(seen);
        mockHidden.mockRejectedValue(new Error("throttled"));
        const body = await call();
        expect(body.count, "ブロックを読めないだけで閲覧者が消えている").toBe(2);
    });

    it("閲覧者が居なければブロック一覧も引きに行かない", async () => {
        withViewers({});
        mockHidden.mockResolvedValue(new Set<string>());
        await invoke(getStoryViewers, authedEvent("owner", { pathParameters: { id: "story-1" } }));
        expect(mockHidden, "閲覧者が居ないのにブロック一覧を読んでいる").not.toHaveBeenCalled();
    });
});

// ────────────────────────────────
// 期限切れクリーンアップ
// ────────────────────────────────
describe("cleanupExpiredStories", () => {
    it("期限切れストーリーの S3 オブジェクトと DDB レコードを削除する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "story-1", key: "uploads/a.jpg", src: "https://cdn.test/uploads/a.jpg" }] }) // scan
            .mockResolvedValueOnce({}); // delete
        mockS3Send.mockResolvedValueOnce({});

        const result = await cleanupExpiredStories();
        expect(result.deleted).toBe(1);
        const input = (mockS3Send.mock.calls[0][0] as { input: { Bucket: string } }).input;
        expect(input.Bucket).toBe("bucket-test");
        expect(deletedKeys()).toEqual(["uploads/a.jpg"]);
    });

    it("key が無い場合は src の URL パスから導出する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "story-2", src: "https://cdn.test/uploads/b.mp4" }] })
            .mockResolvedValueOnce({});
        mockS3Send.mockResolvedValueOnce({});

        await cleanupExpiredStories();
        expect(deletedKeys()).toEqual(["uploads/b.mp4"]);
    });

    // 上と同じ向きの変更。期限切れのストーリーは利用者から見えないので、
    // 行が残っても害は無く、翌日の実行が同じキーをもう一度消しに行く。
    // 逆に行だけ消すと、GPS 入りの動画が誰にも辿れないまま残る。
    it("S3 削除に失敗したら行を残す（翌日やり直せる）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "story-3", key: "uploads/c.jpg" }] });
        mockS3Send.mockRejectedValueOnce(new Error("s3 down"));

        const result = await cleanupExpiredStories();
        expect(result.deleted).toBe(0);
        const deletes = mockDdbSend.mock.calls.filter(
            (c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(deletes, "S3 が消せていないのに行を消した").toHaveLength(0);
    });

    it("1件失敗しても、消せた分は消す（全部止めない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [
                { id: "bad", key: "uploads/bad.jpg" },
                { id: "good", key: "uploads/good.jpg" },
            ] })
            .mockResolvedValueOnce({});
        // まとめ消しは投げずに `Errors` を返す形でも失敗を伝える
        mockS3Send
            .mockResolvedValueOnce({ Errors: [{ Key: "uploads/bad.jpg" }] })
            .mockResolvedValueOnce({});

        const result = await cleanupExpiredStories();
        expect(result.deleted).toBe(1);
        const deletes = mockDdbSend.mock.calls.filter(
            (c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        const keys = deletes.map((c) => (c[0] as { input: { Key: { id: string } } }).input.Key.id);
        // 消せた方だけ。返信の文書も一緒に（行より先に）
        expect(keys).toEqual(["storyreplies#good", "storyvotes#good", "good", "storyvotes#good"]);
    });

    // 掃除も同じ。消せなければ行を残して次回に回す
    it("返信を消せなかった行は残す（次回に回す）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "QueryCommand" || cmd.constructor.name === "ScanCommand") {
                return Promise.resolve({ Items: [{ id: "bad", key: "uploads/bad.jpg" }] });
            }
            if (id.startsWith("storyreplies#")) return Promise.reject(new Error("boom"));
            return Promise.resolve({});
        });
        mockS3Send.mockResolvedValue({});
        const result = await cleanupExpiredStories();
        expect(result.deleted, "返信を消せていないのに数えている").toBe(0);
        const rowDeleted = mockDdbSend.mock.calls.some((c) => {
            const cmd = c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } };
            return cmd.constructor.name === "DeleteCommand" && cmd.input.Key?.id === "bad";
        });
        expect(rowDeleted, "辿る手がかり（行）まで消している").toBe(false);
    });

    it("期限切れが無ければ何もしない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [] });
        const result = await cleanupExpiredStories();
        expect(result.deleted).toBe(0);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    // **どちら側を引くかを固定する。**
    //
    // 上の4本は「返ってきたものを消したか」しか見ていない。モックは
    // 問い合わせの中身に関係なく Items を返すので、抽出条件を
    // `expiresAt <= :now` から `>` に反転しても4本とも通る——
    // つまり**毎日 04:00 の cron が生きているストーリーを全部消して、
    // 期限切れは1件も消さない**ようになっても誰も気づけない。
    //
    // 同じファイルの getStories には「Scan ではなく専用の索引を Query する」
    // という対の検証がある。片側だけ抜けていた。
    it("期限切れ側は expiresAt <= now を引く（生きている分を消さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [] });
        await cleanupExpiredStories();

        const q = mockDdbSend.mock.calls[0][0] as {
            constructor: { name: string };
            input: { IndexName?: string; KeyConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
        };
        expect(q.constructor.name).toBe("QueryCommand");
        expect(q.input.IndexName).toBe("storyFeed-expiresAt-index");
        expect(q.input.KeyConditionExpression).toBe("storyFeed = :k AND expiresAt <= :now");
        expect(q.input.ExpressionAttributeValues?.[":k"]).toBe("1");
    });

    it("索引が無い環境のフォールバックでも expiresAt <= now を引く", async () => {
        // GSI 未作成の環境（story-index を流す前）はこちらを通る。
        // ここが反転していると、同じく生きている分を消す。
        mockDdbSend
            .mockRejectedValueOnce(Object.assign(new Error("no index"), { name: "ValidationException" }))
            .mockResolvedValueOnce({ Items: [] });
        await cleanupExpiredStories();

        const scan = mockDdbSend.mock.calls[1][0] as {
            constructor: { name: string };
            input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
        };
        expect(scan.constructor.name).toBe("ScanCommand");
        // アーカイブ済み（`storyFeed` を外し `archivedAt` を刻んだ行）は拾わない
        // ——毎時撫で直さないための絞り込み。**式全体を完全一致で見る唯一の
        // 見張り**（`storyArchive.test.ts` は重ねない）: DynamoDB は AND が OR
        // より先に結びつくので、括弧が落ちると `(... AND storyFeed) OR
        // archivedAt 無し`＝表の写真・コメント・印の行が全部「期限切れ」として
        // 削除の経路に流れる
        expect(scan.input.FilterExpression).toBe("story = :t AND expiresAt <= :now AND (attribute_exists(storyFeed) OR attribute_not_exists(archivedAt))");
        expect(scan.input.ExpressionAttributeValues?.[":t"]).toBe(true);
    });
});

// 一覧側は逆で、生きている分だけを引く。
// active と expired が同じ三項で分かれているので、両側を固定しないと
// 「三項ごと潰す」変異を捕まえられない。
/**
 * 投票スタンプの票の状態（`vote`）。**持つ行にだけ付ける・読みに行く。**
 * 数（`counts`）は投稿者と票を入れた人だけ（`storyVoteState` が決める）。
 */
describe("getStories: 投票の状態", () => {
    const VOTE = { kind: "vote", question: "好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05 };
    const rows = (items: Array<Record<string, unknown>>, votes: Record<string, unknown> | "fail" | undefined) => {
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const key = (cmd.input.Key as { id?: string } | undefined)?.id ?? "";
                if (key.startsWith("storyvotes#")) {
                    if (votes === "fail") return Promise.reject(new Error("throttled"));
                    return Promise.resolve(votes ? { Item: { id: key, ...votes } } : {});
                }
                return Promise.resolve({});
            }
            return Promise.resolve({ Items: items });
        });
    };
    const first = async (me: string) =>
        (JSON.parse((await invoke(getStories, authedEvent(me))).body) as Array<{ vote?: unknown }>)[0];
    const voteReads = () => mockDdbSend.mock.calls
        .map((c) => (c[0].input as { Key?: { id?: string } })?.Key?.id ?? "")
        .filter((k) => k.startsWith("storyvotes#"));

    it("投稿者には数が付く（入れていなくても）", async () => {
        rows([{ id: "s1", userId: "me", createdAt: "1", texts: [VOTE] }], { votersA: new Set(["u1", "u2"]), votersB: new Set(["u3"]) });
        expect((await first("me")).vote).toEqual({ counts: { a: 2, b: 1 } });
    });

    it("票を入れた人には自分の票と数", async () => {
        rows([{ id: "s1", userId: "owner", createdAt: "1", texts: [VOTE] }], { votersA: new Set(["u1"]), votersB: new Set(["me"]) });
        expect((await first("me")).vote).toEqual({ myVote: "b", counts: { a: 1, b: 1 } });
    });

    // **入れる前に数を見せない**（多い方に寄る）
    it("まだ入れていない人には、票も数も無い（空）", async () => {
        rows([{ id: "s1", userId: "owner", createdAt: "1", texts: [VOTE] }], { votersA: new Set(["u1"]) });
        expect((await first("me")).vote).toEqual({});
    });

    it("投票スタンプの無い行には付けず、読みにも行かない", async () => {
        rows([{ id: "s1", userId: "owner", createdAt: "1", texts: [{ text: "朝", x: 0.5, y: 0.5, size: 0.06 }] }], undefined);
        expect((await first("me")).vote, "投票の無い行に vote を付けている").toBeUndefined();
        expect(voteReads(), "投票の無い行の票を読みに行っている").toHaveLength(0);
    });

    // 読めなければ付けない（一覧は返す）。画面は「まだ入れていない」の形になり、
    // 押せば書き込みが2票目を断る
    it("票を読めなくても一覧は返す（vote は付けない）", async () => {
        rows([{ id: "s1", userId: "me", createdAt: "1", texts: [VOTE] }], "fail");
        const res = await invoke(getStories, authedEvent("me"));
        expect(res.statusCode).toBe(200);
        expect((JSON.parse(res.body) as Array<{ vote?: unknown }>)[0].vote).toBeUndefined();
    });
});

describe("getStories: 生きているストーリーだけを引く", () => {
    it("expiresAt > now を引く", async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [] });
        await invoke(getStories, authedEvent("u1", {}));

        const q = mockDdbSend.mock.calls[0][0] as {
            input: { KeyConditionExpression?: string };
        };
        expect(q.input.KeyConditionExpression).toBe("storyFeed = :k AND expiresAt > :now");
    });
});

// **約束と実体の寿命がずれていた（LEFT-5）。**
//
// ストーリーは「24時間で消える」と言っているのに、掃除が1日1回だったので
// **実体は最大およそ48時間ぶん公開URLで取れた**——期限が切れた直後に掃除が
// 走ったばかりだと、次の掃除まで24時間ある。
//
// 日次にしていたのは `queryStories` が索引の無いテーブルで**全表 Scan** に
// 落ちていたから。2026-09-01 に本番へ `storyFeed-expiresAt-index` を作った
// ので、期限切れのぶんだけを直接引ける＝1時間ごとに回せる。
// スケジュールは serverless.yml にしか無いので、ここで固定する。
describe("期限切れストーリーの掃除は1時間ごと", () => {
    it("serverless.yml のスケジュールが毎時になっている", async () => {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const yml = readFileSync(join(process.cwd(), "api-user/serverless.yml"), "utf8");
        const code = yml.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
        const m = code.match(/schedule:\s*(cron\([^)]*\)|rate\([^)]*\))/);
        expect(m, "cleanupStories のスケジュールが見つからない").not.toBeNull();
        expect(m![1], "日次のままだと、消えたはずのストーリーが最大48時間取れる")
            .not.toMatch(/cron\(\d+\s+\d+\s/);   // 「分 時」が固定＝1日1回
        expect(m![1]).toMatch(/cron\(\d+\s+\*/);  // 時が * ＝毎時
    });
});

/**
 * 写真の上に置いた文字（何枚でも・それぞれ位置と見せ方を持つ）。
 *
 * owner:「インスタみたいにストーリーで好きな場所で文字打てるようにしたい。
 * フォントの種類や色も豊富にしたい」「複数のテキストを別々に置くのもやりたい」
 *
 * **`caption` は文字たちから作る**——文言を2か所で持つと静かにずれる。
 * 残したときの題（`storyKeep.ts`）も検索に出る文章も、`caption` を読む。
 */
describe("createStory: 置いた文字", () => {
    const post = (body: Record<string, unknown>) => invoke(createStory, authedEvent("u1", {
        body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/u1/a.webp", ...body }),
    }));
    const saved = () => (mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: { Item?: Record<string, unknown> } })
        .find((c) => c.constructor.name === "PutCommand")?.input.Item) ?? {};
    const one = { text: "朝の空", x: 0.2, y: 0.8, size: 0.05, font: "mincho", color: "sky", bg: "soft" };

    beforeEach(() => { mockDdbSend.mockResolvedValue({ Count: 0 }); });

    it("受け取って保存する", async () => {
        await post({ texts: [one] });
        expect(saved().texts).toEqual([one]);
    });

    // 🔴 **`caption` は文字たちから作る。** クライアントの申告は使わない
    it("caption は置いた文字から作る（送られた caption は使わない）", async () => {
        await post({ texts: [{ ...one, text: "いち" }, { ...one, text: "に" }], caption: "べつの文言" });
        expect(saved().caption, "文言を2か所で持っている").toBe("いち\nに");
    });

    it("文字を置いていなければ、これまでどおり caption をそのまま受ける", async () => {
        await post({ caption: "朝の空" });
        expect(saved().caption).toBe("朝の空");
        expect("texts" in saved()).toBe(false);
    });

    // **一覧に在る鍵だけ。** 任意の CSS を通さない
    it("知らない字体・色は既定へ落とす（文言と位置は残す）", async () => {
        await post({ texts: [{ text: "朝", x: 0.2, y: 0.8, font: "comic", color: "url(javascript:1)" }] });
        const st = (saved().texts as Record<string, unknown>[])[0];
        expect(st.x).toBe(0.2);
        expect(st.font).not.toBe("comic");
        expect(st.color).toBe("white");
    });

    it("位置は挟む（半分が画面の外へ出ない）", async () => {
        await post({ texts: [{ text: "朝", x: -3, y: 42 }] });
        const st = (saved().texts as { x: number; y: number }[])[0];
        expect(st.x).toBeGreaterThan(0);
        expect(st.y).toBeLessThan(1);
    });

    // **文言が空のものは置き場所だけの項目**——画面に何も描けない
    it("文言が空のものは落とす", async () => {
        await post({ texts: [{ ...one, text: "  " }] });
        expect("texts" in saved(), "空の文字を保存している").toBe(false);
        expect("caption" in saved()).toBe(false);
    });

    it("上限を超えたぶんは落とす", async () => {
        await post({ texts: Array.from({ length: 20 }, (_, i) => ({ ...one, text: `t${i}` })) });
        expect((saved().texts as unknown[]).length).toBeLessThanOrEqual(5);
    });

    it("形が違えば持たない（壊れた値で落ちない）", async () => {
        await post({ texts: "left", caption: "朝" });
        expect("texts" in saved()).toBe(false);
        expect(saved().caption, "caption まで落としている").toBe("朝");
    });
});
