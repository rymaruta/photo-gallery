import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockPutPhoto = vi.hoisted(() => vi.fn());
const mockCountUserPhotos = vi.hoisted(() => vi.fn());
const mockLookupIfSet = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../ddb-photos", () => ({ putPhoto: mockPutPhoto }));
vi.mock("../photoLimit", () => ({ photoLimitError: () => mockCountUserPhotos() }));
vi.mock("../notify", () => ({ lookupDisplayNameIfSet: mockLookupIfSet }));

vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com");
const { keepStory } = await import("../storyKeep");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (e: unknown): Promise<Result> => (keepStory as any)(e);
const ev = (sub: string | undefined, id: string | undefined) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: id ? { id } : undefined,
});
const bodyOf = (r: Result) => JSON.parse(r.body);
const inputs = () => mockDdbSend.mock.calls.map((c) => (c[0] as { input: Record<string, unknown> }).input);

const KEY = "uploads/me/3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607.webp";
const STORY = {
    id: "story-1", story: true, userId: "me", mediaType: "image",
    src: `https://cdn.example.com/${KEY}`, key: KEY,
    caption: "夕暮れの港", createdAt: "2026-07-04T10:00:00.000Z",
    expiresAt: "2099-07-05T10:00:00.000Z",
};

const world = (story: Record<string, unknown> | undefined) => {
    mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) =>
        Promise.resolve(cmd.constructor.name === "GetCommand" ? (story ? { Item: story } : {}) : {}));
};

beforeEach(() => {
    mockDdbSend.mockReset();
    mockPutPhoto.mockReset().mockResolvedValue(undefined);
    mockCountUserPhotos.mockReset().mockResolvedValue(null);   // 上限に達していない
    mockLookupIfSet.mockReset().mockResolvedValue("旅人A");
});

// **このサイトにしかない向き。** Instagram は「投稿 → ストーリーへシェア」
// しか持っていない。ここは逆で、24時間で消えるものを**検索に出る写真**にする。
describe("keepStory: ストーリーをギャラリーに残す", () => {
    it("下書きの写真として作る（黙って検索に出さない）", async () => {
        world(STORY);
        const r = await invoke(ev("me", "story-1"));
        expect(r.statusCode).toBe(200);

        const photo = mockPutPhoto.mock.calls[0][0] as Record<string, unknown>;
        expect(photo.published, "いきなり公開している").toBe(false);
        expect(photo.src).toBe(STORY.src);
        expect(photo.userId).toBe("me");
        // キャプションが題になる（本人が編集画面で直せる）
        expect(photo.title).toEqual("夕暮れの港");
        // 投稿の時刻はストーリーのもの（一覧の並びが正しい位置に来る）
        expect(photo.createdAt).toBe(STORY.createdAt);
        // **撮影日は作らない**（投稿時刻から捏造すると年表と JSON-LD が嘘になる）
        expect("date" in photo, "撮影日をこしらえている").toBe(false);
        expect(bodyOf(r).photoId).toBe(photo.id);
    });

    it("ストーリーに「残した」印を立てる（実体を消さない根拠）", async () => {
        world(STORY);
        await invoke(ev("me", "story-1"));
        const mark = inputs().find((i) => String(i.UpdateExpression ?? "").includes("keptAs"));
        expect(mark, "印を立てていない（期限切れで実体が消える）").toBeTruthy();
        expect(String(mark!.ConditionExpression)).toContain("attribute_not_exists(keptAs)");
    });

    // 同じ実体からは必ず同じID（`upload.ts` と同じ規則）。二度押しても増えない
    it("二度押しても2枚にならない", async () => {
        world(STORY);
        const first = bodyOf(await invoke(ev("me", "story-1"))).photoId;
        mockPutPhoto.mockClear();
        world({ ...STORY, keptAs: first });
        const again = await invoke(ev("me", "story-1"));
        expect(again.statusCode).toBe(200);
        expect(bodyOf(again).photoId).toBe(first);
        expect(bodyOf(again).already).toBe(true);
        expect(mockPutPhoto, "2枚目を作っている").not.toHaveBeenCalled();
    });

    // 印を立てられなかった回の押し直し。写真は既にあるので条件で落ちるが、
    // **そこで 500 にすると永久に残せなくなる**
    it("写真だけ先にできていたら、印を立て直して成功にする", async () => {
        world(STORY);
        mockPutPhoto.mockRejectedValueOnce(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
        const r = await invoke(ev("me", "story-1"));
        expect(r.statusCode).toBe(200);
        expect(inputs().some((i) => String(i.UpdateExpression ?? "").includes("keptAs"))).toBe(true);
    });

    // **印を立てられなかったら、作った写真を片付ける。**
    // 印が無いままだと期限切れで S3 の実体が消え、割れた画像の行が残る
    it("印を立てられなかったら、作った写真を消して失敗を返す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { UpdateExpression?: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: STORY });
            if (String(cmd.input.UpdateExpression ?? "").includes("keptAs")) return Promise.reject(new Error("boom"));
            return Promise.resolve({});
        });
        const r = await invoke(ev("me", "story-1"));
        expect(r.statusCode).toBe(500);
        const del = mockDdbSend.mock.calls.some((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(del, "割れた画像になる写真を残している").toBe(true);
    });

    // 写真の行は画像が前提（サムネも AVIF も sharp が作る）
    it("動画は残せない", async () => {
        world({ ...STORY, mediaType: "video" });
        expect((await invoke(ev("me", "story-1"))).statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("他人のストーリーは残せない（実在も教えない 404）", async () => {
        world({ ...STORY, userId: "someone-else" });
        expect((await invoke(ev("me", "story-1"))).statusCode).toBe(404);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("写真でない行は 404", async () => {
        world({ id: "story-1", src: "https://cdn.example.com/x.jpg", userId: "me" });
        expect((await invoke(ev("me", "story-1"))).statusCode).toBe(404);
    });

    it("未認証は 400", async () => {
        expect((await invoke(ev(undefined, "story-1"))).statusCode).toBe(400);
    });

    // 枚数の上限は写真の口と同じものを使う（複製した規則は静かにずれる）
    it("上限に達していたら断る（写真の口と同じ判定）", async () => {
        world(STORY);
        mockCountUserPhotos.mockResolvedValue({ statusCode: 403, headers: {}, body: JSON.stringify({ error: "上限" }) });
        expect((await invoke(ev("me", "story-1"))).statusCode).toBe(403);
        expect(mockPutPhoto, "上限なのに作っている").not.toHaveBeenCalled();
    });

    it("キャプションが無ければ「無題」", async () => {
        world({ ...STORY, caption: undefined });
        await invoke(ev("me", "story-1"));
        expect((mockPutPhoto.mock.calls[0][0] as { title: unknown }).title).toEqual({ ja: "無題", en: "Untitled" });
    });
});
