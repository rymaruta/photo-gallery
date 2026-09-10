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

/** KEY から `idFromUploadKey`（uuidv5）で決まる値。**手で書かない**——
 *  ずれると「印が実は立っていた」の分岐に入らず、何も検証しないテストになる */
const KEPT_ID = "66bd8e0f-536c-5dd5-b9f8-82b6460587e0";
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
    // **手で書いた KEPT_ID が実装と一致していることを、まず確かめる。**
    // ずれると「印が実は立っていた」の分岐に入らず、何も検証しなくなる
    it("KEPT_ID は実装が導く写真IDと同じ", async () => {
        world(STORY);
        const r = await invoke(ev("me", "story-1"));
        expect(bodyOf(r).photoId, "フィクスチャの写真IDが実装とずれている").toBe(KEPT_ID);
    });

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

    // **掃除との競合を広げない。** `cleanupExpiredStories` は期限切れを
    // 一度に読んだスナップショットで回すので、「読んだ後・消す前」に印が
    // 立つと **S3 だけ消えた写真**ができる。期限切れは画面から押せない
    it("期限切れのストーリーは残せない", async () => {
        world({ ...STORY, expiresAt: "2020-01-01T00:00:00.000Z" });
        expect((await invoke(ev("me", "story-1"))).statusCode).toBe(404);
        expect(mockPutPhoto, "期限切れなのに作っている").not.toHaveBeenCalled();
    });

    // 写真を消すときに、まだ生きているストーリーも消すために要る
    it("写真に出どころ（keptFrom）を書く", async () => {
        world(STORY);
        await invoke(ev("me", "story-1"));
        expect((mockPutPhoto.mock.calls[0][0] as { keptFrom?: string }).keptFrom,
            "出どころが無いと、写真を消しても割れたストーリーが残る").toBe("story-1");
    });

    // **例外の名前で決め打ちしない。** 条件は2つ見ているので、
    // 条件不成立は「もう立っている」と「行がもう無い」の両方で起きる
    it("印が実は立っていたら、成功として返す（写真を消さない）", async () => {
        let marked = false;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { UpdateExpression?: string } }) => {
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve({ Item: marked ? { ...STORY, keptAs: KEPT_ID } : STORY });
            }
            if (String(cmd.input.UpdateExpression ?? "").includes("keptAs")) {
                marked = true;   // DynamoDB では書けたが、応答は失敗で返る
                return Promise.reject(new Error("timeout"));
            }
            return Promise.resolve({});
        });
        const r = await invoke(ev("me", "story-1"));
        expect(r.statusCode, "書けているのに失敗にしている").toBe(200);
        const del = mockDdbSend.mock.calls.some((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(del, "残った写真を消している（辿れない孤児になる）").toBe(false);
    });

    // 行がもう無い（掃除と競合）。**成功にしてはいけない**
    // ——S3 は掃除に消された後なので、割れた写真がギャラリーに残る
    it("ストーリーの行が消えていたら、作った写真を片付ける", async () => {
        let gone = false;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { UpdateExpression?: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve(gone ? {} : { Item: STORY });
            if (String(cmd.input.UpdateExpression ?? "").includes("keptAs")) {
                gone = true;
                return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        const r = await invoke(ev("me", "story-1"));
        expect(r.statusCode, "行が消えているのに成功と言っている").toBe(500);
        const del = mockDdbSend.mock.calls.some((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(del, "割れた写真をギャラリーに残している").toBe(true);
    });

    // **ここがこの機能の要。** 撮影地 → 地図 → `/location/<スラッグ>` →
    // 検索流入、という段差を渡るために、ストーリーで付けた場所をそのまま持つ
    it("撮影地と座標を引き継ぐ（地図に載る写真になる）", async () => {
        world({ ...STORY, location: "横浜 みなとみらい", coords: { lat: 35.45, lng: 139.63 } });
        await invoke(ev("me", "story-1"));
        const photo = mockPutPhoto.mock.calls[0][0] as Record<string, unknown>;
        expect(photo.location, "撮影地が落ちている（残しても何にも繋がらない）").toBe("横浜 みなとみらい");
        expect(photo.coords).toEqual({ lat: 35.45, lng: 139.63 });
        // `geoApprox` は「地名から機械が引いた値」の印。GPS 由来には立てない
        expect("geoApprox" in photo, "撮影時の GPS に「おおよそ」の印を付けている").toBe(false);
    });

    it("場所が無いストーリーは、場所の項目を持たない", async () => {
        world(STORY);
        await invoke(ev("me", "story-1"));
        const photo = mockPutPhoto.mock.calls[0][0] as Record<string, unknown>;
        expect("location" in photo).toBe(false);
        expect("coords" in photo).toBe(false);
    });

    // 端末が作って送るサムネ。無いまま公開すると一覧が 1440px の原寸を読む
    it("サムネ・代表色・ぼかしを受け取る", async () => {
        world(STORY);
        await invoke({
            ...ev("me", "story-1"),
            body: JSON.stringify({
                thumbUrl: "https://cdn.example.com/uploads/me/t.webp",
                dominantColor: "#AABBCC",
                blurDataURL: "data:image/webp;base64,zz",
            }),
        });
        const photo = mockPutPhoto.mock.calls[0][0] as Record<string, unknown>;
        expect(photo.thumbSrc).toBe("https://cdn.example.com/uploads/me/t.webp");
        expect(photo.dominantColor, "小文字に揃えていない").toBe("#aabbcc");
        expect(photo.blurDataURL).toBe("data:image/webp;base64,zz");
    });

    // **他人の領域・外部のURLは通さない**（写真の保存と同じ判定）。
    // 通ると、一覧を見た人全員の IP を集められる
    it("他人の領域を指すサムネは捨てる", async () => {
        world(STORY);
        await invoke({
            ...ev("me", "story-1"),
            body: JSON.stringify({ thumbUrl: "https://evil.example/t.webp" }),
        });
        expect("thumbSrc" in (mockPutPhoto.mock.calls[0][0] as Record<string, unknown>),
            "外部のURLを一覧に出している").toBe(false);
    });

    // **見ていたのは外部ホストだけだった。** 同じ CDN の**他人の領域**を
    // 指す URL は無検証で、`isOwnUploadUrl` の接頭辞の判定を落としても
    // 22件が緑のままだった（変異で確認）。`thumbSrc` は `mediaKeys` に
    // 入るので、ここを抜けると **他人の実ファイルを自分の写真として
    // 消せる**——`upload.ts` が「相手の実ファイルが S3 から消えた」と
    // 書いている当の事故と同じ形。
    it("同じ CDN でも、他人の領域を指すサムネは捨てる", async () => {
        world(STORY);
        await invoke({
            ...ev("me", "story-1"),
            body: JSON.stringify({ thumbUrl: "https://cdn.example.com/uploads/other/t.webp" }),
        });
        expect("thumbSrc" in (mockPutPhoto.mock.calls[0][0] as Record<string, unknown>),
            "他人の領域のファイルを自分の写真に付けている").toBe(false);
    });

    it("本文が無くても残せる（サムネは任意）", async () => {
        world(STORY);
        expect((await invoke(ev("me", "story-1"))).statusCode).toBe(200);
    });

    it("壊れた本文でも残せる", async () => {
        world(STORY);
        const r = await invoke({ ...ev("me", "story-1"), body: "{broken" });
        expect(r.statusCode).toBe(200);
    });

    it("キャプションが無ければ「無題」", async () => {
        world({ ...STORY, caption: undefined });
        await invoke(ev("me", "story-1"));
        expect((mockPutPhoto.mock.calls[0][0] as { title: unknown }).title).toEqual({ ja: "無題", en: "Untitled" });
    });
});
