import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ストーリーは**フォロワーだけ**が見る（2026-09-22・owner の判断。
 * 経緯は `storyVisibility.ts` の節）。公開範囲の選択は無くなったので、
 * ここで見るのは**「フォローしているか」1本で門が閉まっているか**。
 *
 * **門は4つある。** 一覧（`getStories`）・閲覧の記録（`viewStory`）・
 * 返信（`postStoryReply`）・投票（`voteStory`）。一覧だけ塞いでも、
 * 期限をまたいで開きっぱなしのタブと直接叩く経路が残る
 * （`viewStory` 自身のコメントがそう書いている）。1つでも抜けると
 * 「見せないつもりの相手が閲覧者一覧に並ぶ」形になる。
 *
 * ⚠️ **`visibility` の列は死んでいる**。古い行には `"followers"` が
 * 残っているが誰も読まない。**その列を見て分岐する実装に戻していないか**も
 * ここで見る（列を見ると、列の無い行と有る行で門の広さが割れる）。
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
const { voteStory } = await import("../storyVotes");
const { storyAllowsReplies } = await import("../storyVisibility");
const { followMarkerId } = await import("../followCheck");

type Result = { statusCode: number; headers?: Record<string, string>; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

const ev = (sub: string | undefined, overrides: Record<string, unknown> = {}) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    ...overrides,
});

// **実在する形の ID を使う。** 本物のIDは UUID なので、テストもそれに揃える
// ——`follow#<相手>#<自分>` のマーカーを引くだけなので形に縛りは無いが、
// 形の違う値で通ってしまうテストを書かないため
const ME = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const FUTURE = new Date(Date.now() + 60_000).toISOString();
/** 公開範囲があった頃の行（今は誰も読まない列） */
const DEAD_COLUMN = { visibility: "followers" };

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset();
    mockHidden.mockReset().mockResolvedValue(new Set<string>());
    mockLookup.mockReset().mockResolvedValue("名前");
});

// ────────────────────────────────
// 値の解釈（規則は1か所）
// ────────────────────────────────
describe("storyAllowsReplies", () => {
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

    it("返信なしを保存する", async () => {
        await post({ allowReplies: false });
        // **`false` を書く。** 値で分岐すると（`...(allowReplies ? ... )`）
        // ここが黙って消え、切ったはずの返信が届く
        expect(saved().allowReplies).toBe(false);
    });

    // 画面の公開範囲は無くなったが、古い版の画面・直接叩く経路からは
    // まだ送られうる。**受け取っても保存しない**——保存すると、読む側が
    // 見ていない列に「設定したつもり」が溜まる
    it("`visibility` を送ってきても保存しない（死んだ列を復活させない）", async () => {
        await post({ visibility: "public" });
        expect(saved(), "誰も読まない列を書いている").not.toHaveProperty("visibility");
        mockDdbSend.mockClear();
        await post({ visibility: "followers" });
        expect(saved()).not.toHaveProperty("visibility");
    });
});

// ────────────────────────────────
// GET /stories — 一覧のふるい
// ────────────────────────────────
describe("getStories: フォロワーだけ", () => {
    /**
     * ストーリーの一覧と、フォローのマーカーが返す世界。
     *
     * **一覧（`following#<自分>`）は置かない。** 置くと、実装がうっかり
     * そちらを読んでも緑になる——判定をマーカーへ移した理由が
     * 「一覧は解除の取りこぼしで残る／2000で切り捨てられる」なので、
     * ここで両方用意すると**その区別を確かめられないテスト**になる。
     */
    function world(items: Record<string, unknown>[], followed: string[] | "fail") {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String(cmd.input.Key?.id ?? "");
                if (followed === "fail" && id.startsWith("follow#")) return Promise.reject(new Error("throttled"));
                if (followed !== "fail" && followed.some((o) => id === followMarkerId(o, ME))) {
                    return Promise.resolve({ Item: { id } });
                }
                return Promise.resolve({});
            }
            return Promise.resolve({ Items: items });
        });
    }
    const ids = async () => (JSON.parse((await invoke(getStories, ev(ME))).body) as Array<{ id: string }>).map((i) => i.id);
    const followReads = () => mockDdbSend.mock.calls
        .map((c) => String((c[0] as { input: { Key?: { id?: string } } }).input.Key?.id ?? ""))
        .filter((id) => id.startsWith("follow#"));

    const FEED = [
        { id: "stranger-plain", userId: STRANGER, createdAt: "1" },
        { id: "friend-plain", userId: FRIEND, createdAt: "2" },
        { id: "friend-old-column", userId: FRIEND, createdAt: "3", ...DEAD_COLUMN },
        { id: "stranger-old-column", userId: STRANGER, createdAt: "4", ...DEAD_COLUMN },
        { id: "mine", userId: ME, createdAt: "5" },
    ];

    // 🔴 ここが今回の変更の本体。**列の有無で割れない**
    it("フォローしている人のだけ出す（列の有無で割れない）", async () => {
        world(FEED, [FRIEND]);
        expect(await ids(), "フォローのふるいが効いていない").toEqual(["friend-plain", "friend-old-column", "mine"]);
    });

    it("自分のは自分に出す（自分は自分をフォローしていない）", async () => {
        // ここが抜けると、投稿した本人のバーから自分のストーリーが消える
        world(FEED, []);
        expect(await ids()).toEqual(["mine"]);
        expect(followReads(), "自分のぶんを確かめに行っている").not.toContain(followMarkerId(ME, ME));
    });

    it("フォローを確かめられなかったら出さない（取り返せない側に倒さない）", async () => {
        // ブロック一覧（`hiddenUserIds`）は逆に「読めなくても一覧は返す」。
        // 倒しすぎると誰のストーリーも出なくなるあちらと、見せないと決めた
        // 相手に中身が出てしまうこちらとで、危ない向きが違う
        world(FEED, "fail");
        expect(await ids()).toEqual(["mine"]);
    });

    it("自分のしか無ければ、フォローを1回も読まない", async () => {
        // 誰も居ない往復を増やさない
        world([{ id: "mine", userId: ME, createdAt: "1" }], []);
        await ids();
        expect(followReads()).toEqual([]);
    });

    it("同じ人が何本出していても、確かめるのは1回", async () => {
        world([
            { id: "a", userId: FRIEND, createdAt: "1" },
            { id: "b", userId: FRIEND, createdAt: "2" },
            { id: "c", userId: FRIEND, createdAt: "3" },
        ], [FRIEND]);
        expect(await ids()).toEqual(["a", "b", "c"]);
        expect(followReads(), "行の数だけ読んでいる").toEqual([followMarkerId(FRIEND, ME)]);
    });

    it("ブロックはフォローしていても勝つ", async () => {
        mockHidden.mockResolvedValue(new Set([FRIEND]));
        world(FEED, [FRIEND]);
        expect(await ids()).toEqual(["mine"]);
    });

    it("`allowReplies` は落とさない（見る人の画面が返信の帯を出すかを決める）", async () => {
        world([{ id: "s1", userId: FRIEND, createdAt: "1", allowReplies: false }], [FRIEND]);
        const items = JSON.parse((await invoke(getStories, ev(ME))).body) as Array<{ allowReplies?: boolean }>;
        expect(items[0].allowReplies, "返信の可否が画面まで届かない").toBe(false);
    });
});

// ────────────────────────────────
// 直接叩く3つの口（一覧を通らない経路）
// ────────────────────────────────

/** ストーリー1件と、フォローのマーカーだけが在る世界 */
function oneStory(story: Record<string, unknown>, follows: boolean, extra: Record<string, unknown> = {}) {
    mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
        const id = String(cmd.input.Key?.id ?? "");
        if (cmd.constructor.name === "GetCommand") {
            if (id === "story-1") return Promise.resolve({ Item: story });
            if (id === followMarkerId(FRIEND, ME)) return Promise.resolve(follows ? { Item: { id } } : {});
            if (id in extra) return Promise.resolve({ Item: extra[id] });
            return Promise.resolve({});
        }
        return Promise.resolve({});
    });
}
const updates = () => mockDdbSend.mock.calls.filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "UpdateCommand");

describe("viewStory: フォロワーだけ", () => {
    const view = () => invoke(viewStory, ev(ME, { pathParameters: { id: "story-1" } }));
    const base = { id: "story-1", story: true, userId: FRIEND, expiresAt: FUTURE };

    it("フォローしていない人の閲覧は記録せず 404", async () => {
        oneStory(base, false);
        expect((await view()).statusCode).toBe(404);
        expect(updates(), "見せないと決めた相手が閲覧者一覧に載っている").toHaveLength(0);
    });

    it("フォローしていれば記録する", async () => {
        oneStory(base, true);
        expect((await view()).statusCode).toBe(200);
        expect(updates().length).toBeGreaterThan(0);
    });

    // 列の有無で門が割れないこと（`visibility` を読む実装に戻したら落ちる）
    it("古い `visibility` の列が有っても無くても同じ門", async () => {
        oneStory({ ...base, ...DEAD_COLUMN }, true);
        expect((await view()).statusCode).toBe(200);
        mockDdbSend.mockReset();
        oneStory({ ...base, ...DEAD_COLUMN }, false);
        expect((await view()).statusCode).toBe(404);
    });
});

describe("postStoryReply: フォロワーだけ ＋ 「返信を許可」", () => {
    const send = () => invoke(postStoryReply, ev(ME, {
        pathParameters: { id: "story-1" }, body: JSON.stringify({ text: "いいね" }),
    }));
    const base = { id: "story-1", story: true, userId: FRIEND, src: "https://cdn/s.jpg", expiresAt: FUTURE };
    const replies = { [storyRepliesId("story-1")]: { items: [] } };
    const wrote = () => updates().length > 0;

    it("フォローしていない相手には返せない（404・在ることも教えない）", async () => {
        oneStory(base, false, replies);
        expect((await send()).statusCode).toBe(404);
        expect(wrote(), "返信が保存されている").toBe(false);
    });

    it("フォローしていれば返せる", async () => {
        oneStory(base, true, replies);
        expect((await send()).statusCode).toBe(200);
    });

    // 返信の可否は**伏せる理由が無い**（見えている相手に対する設定なので
    // 403 と理由を返す）。見せない相手への 404 とは向きが違う
    it("返信を切っていたら 403 と理由を返す", async () => {
        oneStory({ ...base, allowReplies: false }, true, replies);
        const res = await send();
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error, "理由が伝わらない").toContain("返信");
        expect(wrote(), "返信が保存されている").toBe(false);
    });

    it("古い `visibility` の列は見ない", async () => {
        oneStory({ ...base, ...DEAD_COLUMN }, true, replies);
        expect((await send()).statusCode).toBe(200);
    });
});

describe("voteStory: フォロワーだけ", () => {
    const vote = () => invoke(voteStory, ev(ME, {
        pathParameters: { id: "story-1" }, body: JSON.stringify({ choice: "a" }),
    }));
    const base = {
        id: "story-1", story: true, userId: FRIEND, expiresAt: FUTURE,
        texts: [{ kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05 }],
    };

    it("フォローしていない人は投票できない（404・記録しない）", async () => {
        oneStory(base, false);
        expect((await vote()).statusCode).toBe(404);
        expect(updates(), "見せないと決めた相手の票が入っている").toHaveLength(0);
    });

    it("フォローしていれば投票できる", async () => {
        oneStory(base, true);
        expect((await vote()).statusCode, "フォロワーが投票できない").toBe(200);
    });
});
