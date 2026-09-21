import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ストーリーの公開設定（公開範囲・返信を許可）。
 *
 * **門は3つある。** 一覧（`getStories`）・閲覧の記録（`viewStory`）・
 * 返信（`postStoryReply`）。一覧だけ塞いでも、期限をまたいで開きっぱなしの
 * タブと直接叩く経路が残る（`viewStory` 自身のコメントがそう書いている）。
 * ここでは**3つとも**見る——1つでも抜けると「見せないつもりの相手が
 * 閲覧者一覧に並ぶ」形になる。
 */

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
    DeleteObjectsCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");

// ブロックと退会は境界にする（`stories.test.ts` と同じ形）。
// **フォローは本物を通す**——このファイルが見たいのは、まさにその判定が
// どの行・どのマーカーから来るか（モックすると「何も確かめていない」になる）
const mockHidden = vi.hoisted(() => vi.fn(async () => new Set<string>()));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: async () => false,
    hiddenUserIds: (...a: unknown[]) => mockHidden(...(a as [])),
}));
const mockLookup = vi.hoisted(() => vi.fn(async () => "名前"));
vi.mock("../notify", async (importActual) => ({
    ...(await importActual<typeof import("../notify")>()),
    lookupDisplayName: () => mockLookup(),
    deletedUserIds: async () => new Set<string>(),
    pushNotification: async () => undefined,
}));

const { getStories, createStory, viewStory } = await import("../stories");
const { postStoryReply, storyRepliesId } = await import("../storyReplies");
const { storyVisibility, storyAllowsReplies, STORY_PUBLIC, STORY_FOLLOWERS_ONLY } =
    await import("../storyVisibility");
const { followMarkerId, followingId } = await import("../followCheck");

type Result = { statusCode: number; headers?: Record<string, string>; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

const ev = (sub: string | undefined, overrides: Record<string, unknown> = {}) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    ...overrides,
});

// **実在する形の ID を使う。** `followingIds` は `isUserId`（UUID）で濾すので、
// 適当な文字列を並べると一覧が空になり、**門が効いているのか ID の形で
// 落ちているのか区別できない**テストになる
const ME = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const FUTURE = new Date(Date.now() + 60_000).toISOString();

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset();
    mockHidden.mockReset().mockResolvedValue(new Set<string>());
    mockLookup.mockReset().mockResolvedValue("名前");
});

// ────────────────────────────────
// 値の解釈（規則は1か所）
// ────────────────────────────────
describe("storyVisibility / storyAllowsReplies", () => {
    it("無い・null・public は「全員に公開」（この列を持たない古い行が全部隠れない）", () => {
        for (const raw of [undefined, null, STORY_PUBLIC]) {
            expect(storyVisibility(raw), `${String(raw)} が全員に公開になっていない`).toBe(STORY_PUBLIC);
        }
    });

    it("知らない値は「フォロワーのみ」に倒す（広すぎる側は取り返せない）", () => {
        // 「親しい友達」を足したとき、その値を知らない版のサーバーに当たった
        // 投稿が全員に出る——という形を作らないための線
        for (const raw of ["closeFriends", "followers", "", 1, {}]) {
            expect(storyVisibility(raw), `${JSON.stringify(raw)} が全員に公開に倒れている`).toBe(STORY_FOLLOWERS_ONLY);
        }
    });

    it("返信は既定で受ける。false を明示したときだけ断る", () => {
        for (const raw of [undefined, null, true, 0, "false"]) {
            expect(storyAllowsReplies(raw), `${String(raw)} で黙って閉じている`).toBe(true);
        }
        expect(storyAllowsReplies(false)).toBe(false);
    });
});

// ────────────────────────────────
// POST /stories — 保存
// ────────────────────────────────
describe("createStory: 公開設定", () => {
    const post = (body: Record<string, unknown>) => invoke(createStory, ev(ME, {
        body: JSON.stringify({ publicUrl: `https://cdn.test/uploads/${ME}/a.webp`, ...body }),
    }));
    const saved = () => (mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: { Item?: Record<string, unknown> } })
        .find((c) => c.constructor.name === "PutCommand")?.input.Item) ?? {};

    beforeEach(() => { mockDdbSend.mockResolvedValue({ Count: 0 }); });

    it("既定（何も送らない）は列を持たない＝移行なしで今までどおり", async () => {
        expect((await post({})).statusCode).toBe(201);
        expect(saved()).not.toHaveProperty("visibility");
        expect(saved()).not.toHaveProperty("allowReplies");
    });

    it("フォロワーのみ・返信なしを保存する", async () => {
        await post({ visibility: STORY_FOLLOWERS_ONLY, allowReplies: false });
        expect(saved().visibility).toBe(STORY_FOLLOWERS_ONLY);
        // **`false` を書く。** 値で分岐すると（`...(allowReplies ? ... )`）
        // ここが黙って消え、切ったはずの返信が届く
        expect(saved().allowReplies).toBe(false);
    });

    it("public を明示しても列は書かない（既定は保存しない）", async () => {
        await post({ visibility: STORY_PUBLIC, allowReplies: true });
        expect(saved()).not.toHaveProperty("visibility");
        expect(saved()).not.toHaveProperty("allowReplies");
    });
});

// ────────────────────────────────
// GET /stories — 一覧のふるい
// ────────────────────────────────
describe("getStories: 公開範囲", () => {
    /** ストーリーの一覧と、`following#<自分>` が返す世界 */
    function world(items: Record<string, unknown>[], following: string[] | "fail") {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            if (cmd.constructor.name === "GetCommand") {
                if (cmd.input.Key?.id === followingId(ME)) {
                    return following === "fail"
                        ? Promise.reject(new Error("throttled"))
                        : Promise.resolve({ Item: { list: following } });
                }
                return Promise.resolve({});
            }
            return Promise.resolve({ Items: items });
        });
    }
    const ids = async () => (JSON.parse((await invoke(getStories, ev(ME))).body) as Array<{ id: string }>).map((i) => i.id);

    const FEED = [
        { id: "pub", userId: STRANGER, createdAt: "1" },
        { id: "friend-only", userId: FRIEND, createdAt: "2", visibility: STORY_FOLLOWERS_ONLY },
        { id: "stranger-only", userId: STRANGER, createdAt: "3", visibility: STORY_FOLLOWERS_ONLY },
        { id: "mine-only", userId: ME, createdAt: "4", visibility: STORY_FOLLOWERS_ONLY },
    ];

    it("フォローしている人のフォロワー限定は出す。していない人のは出さない", async () => {
        world(FEED, [FRIEND]);
        expect(await ids(), "公開範囲のふるいが効いていない").toEqual(["pub", "friend-only", "mine-only"]);
    });

    it("自分のフォロワー限定は自分に出す（`following#` に自分は入っていない）", async () => {
        // ここが抜けると、投稿した本人のバーから自分のストーリーが消える
        world(FEED, []);
        expect(await ids()).toContain("mine-only");
    });

    it("フォロー一覧を読めなかったら、フォロワー限定は出さない（取り返せない側に倒さない）", async () => {
        // ブロック一覧（`hiddenUserIds`）は逆に「読めなくても一覧は返す」。
        // 倒しすぎると誰のストーリーも出なくなるあちらと、見せないと決めた
        // 相手に出てしまうこちらとで、危ない向きが違う
        world(FEED, "fail");
        expect(await ids()).toEqual(["pub", "mine-only"]);
    });

    it("ブロックはフォローしていても勝つ", async () => {
        mockHidden.mockResolvedValue(new Set([FRIEND]));
        world(FEED, [FRIEND]);
        // FRIEND はブロック済みなので `friend-only` は落ちる。
        // `stranger-only` はフォローしていないので落ちる
        expect(await ids()).toEqual(["pub", "mine-only"]);
    });

    it("`allowReplies` は落とさない（見る人の画面が返信の帯を出すかを決める）", async () => {
        world([{ id: "s1", userId: STRANGER, createdAt: "1", allowReplies: false }], []);
        const items = JSON.parse((await invoke(getStories, ev(ME))).body) as Array<{ allowReplies?: boolean }>;
        expect(items[0].allowReplies, "返信の可否が画面まで届かない").toBe(false);
    });
});

// ────────────────────────────────
// POST /stories/{id}/view — 閲覧の記録
// ────────────────────────────────
describe("viewStory: 公開範囲", () => {
    function world(story: Record<string, unknown>, follows: boolean) {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: story });
                if (id === followMarkerId(FRIEND, ME)) return Promise.resolve(follows ? { Item: { id } } : {});
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
    }
    const view = () => invoke(viewStory, ev(ME, { pathParameters: { id: "story-1" } }));
    const followersOnly = {
        id: "story-1", story: true, userId: FRIEND, expiresAt: FUTURE, visibility: STORY_FOLLOWERS_ONLY,
    };
    const updates = () => mockDdbSend.mock.calls.filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "UpdateCommand");

    it("フォローしていない人の閲覧は記録せず 404", async () => {
        world(followersOnly, false);
        expect((await view()).statusCode).toBe(404);
        expect(updates(), "見せないと決めた相手が閲覧者一覧に載っている").toHaveLength(0);
    });

    it("フォローしていれば記録する", async () => {
        world(followersOnly, true);
        expect((await view()).statusCode).toBe(200);
        expect(updates().length).toBeGreaterThan(0);
    });

    it("全員に公開なら、フォローしていなくても記録する", async () => {
        world({ id: "story-1", story: true, userId: FRIEND, expiresAt: FUTURE }, false);
        expect((await view()).statusCode).toBe(200);
        expect(updates().length).toBeGreaterThan(0);
    });
});

// ────────────────────────────────
// POST /stories/{id}/replies — 返信
// ────────────────────────────────
describe("postStoryReply: 公開範囲と「返信を許可」", () => {
    function world(story: Record<string, unknown>, follows: boolean) {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: story });
                if (id === storyRepliesId("story-1")) return Promise.resolve({ Item: { items: [] } });
                if (id === followMarkerId(FRIEND, ME)) return Promise.resolve(follows ? { Item: { id } } : {});
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
    }
    const send = () => invoke(postStoryReply, ev(ME, {
        pathParameters: { id: "story-1" }, body: JSON.stringify({ text: "いいね" }),
    }));
    const base = { id: "story-1", story: true, userId: FRIEND, src: "https://cdn/s.jpg", expiresAt: FUTURE };
    const wrote = () => mockDdbSend.mock.calls.some((c) => (c[0] as { constructor: { name: string } }).constructor.name === "UpdateCommand");

    it("フォローしていない相手のフォロワー限定には返せない（404・設定を教えない）", async () => {
        world({ ...base, visibility: STORY_FOLLOWERS_ONLY }, false);
        expect((await send()).statusCode).toBe(404);
        expect(wrote(), "返信が保存されている").toBe(false);
    });

    it("フォローしていれば返せる", async () => {
        world({ ...base, visibility: STORY_FOLLOWERS_ONLY }, true);
        expect((await send()).statusCode).toBe(200);
    });

    it("返信を切っていたら 403 と理由を返す（伏せる理由が無い）", async () => {
        world({ ...base, allowReplies: false }, false);
        const res = await send();
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error, "理由が伝わらない").toContain("返信");
        expect(wrote(), "返信が保存されている").toBe(false);
    });

    it("既定（列なし）は今までどおり受ける", async () => {
        world(base, false);
        expect((await send()).statusCode).toBe(200);
    });
});
