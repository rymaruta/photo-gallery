import { describe, it, expect, vi, beforeEach } from "vitest";

// 一般ユーザーには自分の写真を消す手段が無かった。写真削除は管理API
// （admin 限定）にしか無く、api-user には deleteStory / deleteComment /
// deleteAccount はあるのに deletePhoto が無い。できるのは「非公開にする」
// だけで S3 の実体は残る——「撮影地に自宅の最寄り駅が写り込んでいた」と
// 気づいた人の選択肢が「隠す（原本は公開URLに残る）」か「退会する」の
// 二択だった。24時間で消えるストーリーは消せるのに、永久に残る写真が消せない。

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());
const mockRemovePin = vi.hoisted(() => vi.fn());
const mockInvalidate = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));
// userProfile は自前の DynamoDB クライアントを持つ（../dynamodb ではない）。
// ここでは「ピン留めから外す」を呼ぶことだけを測り、中身は専用のテストで見る。
vi.mock("../userProfile", () => ({ removePinnedPhoto: mockRemovePin }));
// エッジの掃除（`s3Delete` が呼ぶ）。実物は CloudFront を叩く
vi.mock("../cdnInvalidate", () => ({ invalidateUploads: mockInvalidate }));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectsCommand: class { input: unknown; readonly kind = "s3delete"; constructor(i: unknown) { this.input = i; } },
}));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { deleteMyPhoto } = await import("../photoUpdate");

type Result = { statusCode: number; body: string };
const invoke = (sub: string | undefined, id: string | undefined): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (deleteMyPhoto as any)({
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id === undefined ? undefined : { id },
    });

const ME = "me";
const PHOTO = {
    id: "p1", userId: ME, published: true,
    src: "https://cdn.test/uploads/me/p1.jpg",
    srcOriginal: "https://cdn.test/uploads/me/p1_orig.jpg",
    thumbSrc: "https://cdn.test/uploads/me/p1_thumb.webp",
};

/** DynamoDB で消されたキー */
const deletedIds = () => mockDdbSend.mock.calls
    .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
    .filter((c) => c.constructor.name === "DeleteCommand")
    .map((c) => String((c.input.Key as { id?: string })?.id ?? ""));
/** S3 で消されたキー */
const deletedS3 = () => mockS3Send.mock.calls
    .flatMap((c) => ((c[0] as { input: { Delete?: { Objects?: { Key: string }[] } } }).input.Delete?.Objects ?? []))
    .map((o) => o.Key);

// 既定値を使わない。undefined を渡したら「行が無い世界」にする
// （`= PHOTO` の既定引数だと undefined でも PHOTO に化ける）
function world(item?: Record<string, unknown> | null) {
    const found = item === undefined ? PHOTO : item ?? undefined;
    mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: found });
        return Promise.resolve({});
    });
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset().mockResolvedValue({});
    mockRebuild.mockReset().mockResolvedValue(true);
    mockRemovePin.mockReset().mockResolvedValue(true);
    mockInvalidate.mockReset().mockResolvedValue(true);
});

describe("deleteMyPhoto", () => {
    it("実体（原本・派生を含む）と行とコメントを消す", async () => {
        world();
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(200);
        // GPS 入りの原本まで消す（消し残すと削除後も公開URLで取れる）
        expect(deletedS3()).toEqual(expect.arrayContaining([
            "uploads/me/p1.jpg", "uploads/me/p1_orig.jpg", "uploads/me/p1_thumb.webp",
        ]));
        expect(deletedIds()).toContain("comments#p1");
        expect(deletedIds()).toContain("p1");
    });

    // **エッジからも消す。** ここは自前で `DeleteObjectsCommand` を呼んでいて、
    // 退会・ストーリー削除が通っている `s3DeleteMany`（＝`invalidateUploads`
    // 込み）を通っていなかった。本番実測（2026-09-05）で `/uploads/*` は
    // maxTTL 31536000秒（365日）・実体は `max-age=31536000` なので、
    // **消したはずの写真が最大1年 公開URLで取れる**（GPS 入りの原本も）
    it("消した実体をエッジからも消す（原本を含む）", async () => {
        world();
        await invoke(ME, "p1");

        expect(mockInvalidate, "エッジの掃除を呼んでいない").toHaveBeenCalled();
        const keys = mockInvalidate.mock.calls[0][0] as string[];
        expect(keys).toEqual(expect.arrayContaining([
            "uploads/me/p1.jpg", "uploads/me/p1_orig.jpg", "uploads/me/p1_thumb.webp",
        ]));
    });

    // 逆向き: 消せなかったキーはエッジに回さない（消えていない実体の
    // キャッシュを捨てて取り直させることになり、課金だけ増える）
    it("消せなかったキーはエッジに回さない", async () => {
        world();
        mockS3Send.mockResolvedValue({ Errors: [{ Key: "uploads/me/p1.jpg" }] });
        await invoke(ME, "p1");

        // **`?? []` だけだと空振りする**（呼ばれなければ通る）ので、
        // 消せたぶんが回っていることも見る（レビュー指摘）
        const keys = (mockInvalidate.mock.calls[0]?.[0] ?? []) as string[];
        expect(keys, "消せたぶんは掃除する").toContain("uploads/me/p1_orig.jpg");
        expect(keys).not.toContain("uploads/me/p1.jpg");
    });

    it("S3 を先、行を後（途中で切れても原本が孤児にならない）", async () => {
        world();
        const order: string[] = [];
        mockS3Send.mockImplementation(async () => { order.push("s3"); return {}; });
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: PHOTO });
            if (cmd.constructor.name === "DeleteCommand"
                && String((cmd.input.Key as { id?: string })?.id) === "p1") order.push("row");
            return Promise.resolve({});
        });
        await invoke(ME, "p1");
        expect(order).toEqual(["s3", "row"]);
    });

    it("S3 が消せなかったら行を残して 500（押し直せば続きから消える）", async () => {
        world();
        mockS3Send.mockResolvedValue({ Errors: [{ Key: "uploads/me/p1.jpg" }] });
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(500);
        expect(deletedIds()).not.toContain("p1");
    });

    it("他人の写真は 403（何も消さない）", async () => {
        world({ ...PHOTO, userId: "someone-else" });
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(403);
        expect(deletedS3()).toEqual([]);
        expect(deletedIds()).toEqual([]);
    });

    // `!ownerId` は今は**到達しない守り**（sub 無しは手前の 401 で止まる）。
    // 多層防御として残しているだけで、この1本が測っているのは
    // 「ownerId が無い行は消せない」ことまで。
    it("持ち主のいない行は 403", async () => {
        world({ id: "p1", src: "https://cdn.test/uploads/x.jpg" });
        expect((await invoke(ME, "p1")).statusCode).toBe(403);
    });

    it("sub が無ければ 401（DDB を触らない）", async () => {
        world();
        const res = await invoke("", "p1");
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // 通知 notifs# / コメント comments# / フォロー関係も同じキー空間にいる
    it("# を含む id は 404（写真以外を消させない）", async () => {
        world();
        const res = await invoke(ME, "notifs#me");
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // ストーリーは deleteStory の担当。ここで消すと期限切れ掃除と二重管理になる
    it("ストーリーは 404", async () => {
        world({ ...PHOTO, story: true });
        const res = await invoke(ME, "p1");
        expect(res.statusCode).toBe(404);
        expect(deletedS3()).toEqual([]);
    });

    it("無い写真は 404", async () => {
        world(null);
        expect((await invoke(ME, "p1")).statusCode).toBe(404);
    });

    it("公開写真を消したら静的ページの作り直しを頼む", async () => {
        world();
        await invoke(ME, "p1");
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });

    // **coalesce を付けてはいけない。** rebuild.ts が「削除・退会は素通し」と
    // 明記している。付けると、同じ画面の『保存』が直前にロックを取っている
    // だけで掃除の依頼が見送られ、後から実行されない——消したのに
    // /photo/<id> の静的HTML が残る（cron を止めている今は誰かが次に依頼
    // するまで消えない）。3枚まとめて消して1枚目しか飛ばない形でも踏む。
    it("作り直しの依頼を畳み込ませない（coalesce を付けない）", async () => {
        world();
        await invoke(ME, "p1");
        const opts = mockRebuild.mock.calls[0][1] as { coalesce?: boolean } | undefined;
        expect(opts?.coalesce).toBeUndefined();
    });

    // 消した写真がピン留めの枠を永久に食い潰すのを防ぐ。
    // 行を消したあとでは、どのピンが宙に浮いたか分からなくなる。
    it("ピン留めから外してから行を消す", async () => {
        const order: string[] = [];
        mockRemovePin.mockImplementation(async () => { order.push("unpin"); return true; });
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: PHOTO });
            if (cmd.constructor.name === "DeleteCommand"
                && String((cmd.input.Key as { id?: string })?.id) === "p1") order.push("row");
            return Promise.resolve({});
        });
        await invoke(ME, "p1");

        expect(mockRemovePin).toHaveBeenCalledWith(ME, "p1");
        expect(order).toEqual(["unpin", "row"]);
    });

    it("ピン留めを外せなかったら 500（行を残す）", async () => {
        world();
        mockRemovePin.mockResolvedValue(false);
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(500);
        expect(deletedIds()).not.toContain("p1");
    });

    // 例外（スロットリング・タイムアウト・資格情報切れ）で行を消してしまうと、
    // GPS 入りの原本が公開URLに孤児で残る。Errors 経路だけでなくここも測る。
    it("S3 の削除が例外で落ちても行を残して 500", async () => {
        world();
        mockS3Send.mockRejectedValue(Object.assign(new Error("throttled"), { name: "SlowDown" }));
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(500);
        expect(deletedIds()).not.toContain("p1");
    });

    it("comments# の削除に失敗したら 500（行を残す）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: PHOTO });
            if (cmd.constructor.name === "DeleteCommand"
                && String((cmd.input.Key as { id?: string })?.id) === "comments#p1") {
                return Promise.reject(new Error("throttled"));
            }
            return Promise.resolve({});
        });
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(500);
        expect(deletedIds()).not.toContain("p1");
    });

    // 下書きには静的ページが無いので作り直す中身が無い（A-5d と同じ判定）
    // **「非公開だった写真には静的ページが無い」は、非公開化の依頼が
    // 実際に届いた場合だけ成り立つ。** 届かなかったときは
    // `updatePhotoVisibility` が `staticStale` を立てるので、そこは頼む
    // ——立てないと、非公開 →（依頼が畳まれる／予算切れ）→ 削除 で、
    // 本文・撮影地・EXIF・表示名入り JSON-LD の静的HTMLが誰にも消されない。
    it("非公開でも、掃除が届いていなければ頼む", async () => {
        world({ ...PHOTO, published: false, staticStale: true });
        await invoke(ME, "p1");
        expect(mockRebuild, "静的ページが残るのに掃除を頼んでいない").toHaveBeenCalledTimes(1);
        // 削除の依頼は畳まない（他の削除経路と同じ）
        const opts = mockRebuild.mock.calls[0][1] as { coalesce?: boolean } | undefined;
        expect(opts?.coalesce).not.toBe(true);
    });

    // 削除でも同じ——消したのに `/photo/<id>` の HTML が残ることを画面に伝える
    it("掃除を頼めなかったら、応答で伝える", async () => {
        world(PHOTO);
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(ME, "p1");
        expect(res.statusCode).toBe(200);   // 削除そのものは成立している
        expect(JSON.parse(res.body)).toEqual({ success: true, staticStale: true });
    });

    it("頼めたら載せない", async () => {
        world(PHOTO);
        mockRebuild.mockResolvedValue(true);
        expect(JSON.parse((await invoke(ME, "p1")).body)).toEqual({ success: true });
    });

    it("そもそも静的ページが無い下書きでは載せない", async () => {
        world({ ...PHOTO, published: false });
        mockRebuild.mockResolvedValue(false);
        expect(JSON.parse((await invoke(ME, "p1")).body)).toEqual({ success: true });
    });

    it("下書きなら頼まない", async () => {
        world({ ...PHOTO, published: false });
        await invoke(ME, "p1");
        expect(mockRebuild).not.toHaveBeenCalled();
    });
});


// **共同アルバム（案C）からも取り除く。**
// 残すと、死んだ ID が500枚の枠を食い、招待ページの直近の窓を埋めて
// 「生きている写真があるのに空」に見える。
describe("deleteMyPhoto: 共同アルバム", () => {
    /** アルバムの行に書いた内容 */
    const albumWrites = () => mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
        .filter((c) => c.constructor.name === "UpdateCommand"
            && String((c.input.Key as { id?: string })?.id ?? "").startsWith("album#"))
        .map((c) => c.input);

    it("アルバムに入っていた写真は、一覧から取り除く", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "album#alb-1") return Promise.resolve({ Item: { id, photoIds: ["p0", "p1"] } });
                return Promise.resolve({ Item: { ...PHOTO, albumId: "alb-1" } });
            }
            return Promise.resolve({});
        });
        const res = await invoke(ME, "p1");
        expect(res.statusCode).toBe(200);
        const w = albumWrites();
        expect(w.length, "アルバムを書き直していない").toBe(1);
        expect((w[0].ExpressionAttributeValues as Record<string, unknown>)[":next"]).toEqual(["p0"]);
    });

    it("アルバムに入っていなければ触らない", async () => {
        world(PHOTO);
        await invoke(ME, "p1");
        expect(albumWrites().length).toBe(0);
    });

    // **削除そのものは止めない。** 写真はもう消えているので 500 は嘘になる
    it("アルバムの掃除に失敗しても、削除は成功で返す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "album#alb-1") return Promise.reject(new Error("throttled"));
                return Promise.resolve({ Item: { ...PHOTO, albumId: "alb-1" } });
            }
            return Promise.resolve({});
        });
        expect((await invoke(ME, "p1")).statusCode).toBe(200);
    });
});
