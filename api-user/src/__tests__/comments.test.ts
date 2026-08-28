import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockLookup = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
const mockDeletedIds = vi.hoisted(() => vi.fn(async () => new Set<string>()));
vi.mock("../notify", () => ({
    pushNotification: mockPush,
    lookupDisplayName: mockLookup,
    deletedUserIds: mockDeletedIds,
    DELETED_USER_NAME: "退会したユーザー",
}));

const { getComments, postComment, deleteComment } = await import("../comments");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, params: Record<string, string> | undefined, body?: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: params,
        body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    };
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockDeletedIds.mockReset().mockResolvedValue(new Set<string>());
    mockPush.mockReset().mockResolvedValue(undefined);
    mockLookup.mockReset().mockResolvedValue("旅人A");
});

describe("getComments", () => {
    it("id なしは 400", async () => {
        expect((await invoke(getComments, ev(undefined, undefined))).statusCode).toBe(400);
    });

    // 読み取り側は写真の状態を見ていなかった。投稿側は下書き・ストーリーを
    // 弾いているのに、読む方は素通しだったので、
    //   - 非公開に戻した写真のコメントが誰でも読めたまま
    //   - 削除された写真・退会した人の写真のコメントも読めたまま
    // だった。「不適切なコメントが付いたので非公開にする」が効かない。
    const publicPhoto = { Item: { src: "https://cdn/p1.jpg", published: true } };

    it("非公開の写真のコメントは返さない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", published: false } });
        expect((await invoke(getComments, ev(undefined, { id: "p1" }))).statusCode).toBe(404);
    });

    it("ストーリーのコメントは返さない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/s1.jpg", story: true } });
        expect((await invoke(getComments, ev(undefined, { id: "s1" }))).statusCode).toBe(404);
    });

    it("消えた写真（退会後など）のコメントは返さない", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect((await invoke(getComments, ev(undefined, { id: "gone" }))).statusCode).toBe(404);
    });

    it("新しい順（末尾追記の逆順）で返し、件数も返す", async () => {
        const items = [
            { id: "c1", uid: "u1", name: "A", text: "古い", t: "2026-01-01" },
            { id: "c2", uid: "u2", name: "B", text: "新しい", t: "2026-01-02" },
        ];
        mockDdbSend.mockResolvedValueOnce(publicPhoto);
        mockDdbSend.mockResolvedValueOnce({ Item: { items } });
        const res = await invoke(getComments, ev(undefined, { id: "p1" }));
        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.count).toBe(2);
        expect(data.items[0].id).toBe("c2"); // 新しいのが先頭
    });

    it("コメントが無ければ空配列", async () => {
        mockDdbSend.mockResolvedValueOnce(publicPhoto);
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        const data = JSON.parse((await invoke(getComments, ev(undefined, { id: "p1" }))).body);
        expect(data).toEqual({ items: [], count: 0 });
    });
});

describe("postComment", () => {
    it("認証・id なしは 400", async () => {
        expect((await invoke(postComment, ev(undefined, { id: "p1" }, { text: "hi" }))).statusCode).toBe(400);
    });

    it("空テキストは 400", async () => {
        expect((await invoke(postComment, ev("u1", { id: "p1" }, { text: "   " }))).statusCode).toBe(400);
    });

    it("写真が無ければ 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined }); // photo get
        expect((await invoke(postComment, ev("u1", { id: "ghost" }, { text: "hi" }))).statusCode).toBe(404);
    });

    it("投稿: 追記 + commentCount+1 + 名前はサーバー解決、オーナーに通知", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", thumbSrc: "https://cdn/p1_thumb.webp", userId: "owner", location: "北海道" } }) // photo
            .mockResolvedValueOnce({ Item: { items: [] } })  // 自分のコメント数の確認
            .mockResolvedValueOnce({}) // append
            .mockResolvedValueOnce({}); // count +1
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "  すてき  " }));
        expect(res.statusCode).toBe(200);
        const c = JSON.parse(res.body).comment;
        expect(c.text).toBe("すてき"); // trim
        expect(c.name).toBe("旅人A"); // lookupDisplayName
        expect(c.uid).toBe("u1");
        expect(mockPush).toHaveBeenCalledOnce();
        expect(mockPush.mock.calls[0][0]).toBe("owner");
        expect(mockPush.mock.calls[0][1].type).toBe("comment");
        expect(mockPush.mock.calls[0][1].photoSrc).toBe("https://cdn/p1_thumb.webp");
    });

    it("自分の写真には通知しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "u1" } })
            .mockResolvedValueOnce({ Item: { items: [] } })  // 自分のコメント数の確認
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "self" }));
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("500文字を超えるテキストは切り詰められる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: [] } })  // 自分のコメント数の確認
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "x".repeat(800) }));
        expect(JSON.parse(res.body).comment.text.length).toBe(500);
    });

    // 上限200の輪（古いものから落ちる）なので、1人が200件書けば
    // その写真の議論を全部消せる。履歴もどこにも残らない。
    it("同じ写真への自分のコメントが多すぎたら 429（他人の履歴を流せない）", async () => {
        const mine = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, uid: "u1" }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: mine } });
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        expect(res.statusCode).toBe(429);
        // 追記していない
        expect(mockDdbSend).toHaveBeenCalledTimes(2);
    });

    // 上限の判定は「誰が投稿しようとしているか」で変わる。
    // 呼び出しの順番だけを見るテストにすると、オーナー判定を外しても
    // 別の理由（モックが尽きて 500）で赤くなり、何も確かめていないのに
    // 通ったつもりになる。**同じ材料で結果が分かれること**を見る。
    const fiftyBy = (uid: string) => Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, uid }));
    const commentsGets = () => mockDdbSend.mock.calls
        .filter((c) => c[0].constructor.name === "GetCommand")
        .filter((c) => c[0].input?.Key?.id === "comments#p1");

    it("写真のオーナーは上限の対象外（自分の写真の会話に返信し続けられる）", async () => {
        // 30人にお礼を書くと11人目で止まり、以後は自分のコメントを消すまで
        // 参加できなかった。オーナーには「議論を流す」動機が無いし、
        // 消したければ写真ごと消せる。
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: fiftyBy("owner") } })
            .mockResolvedValueOnce({ Attributes: { items: fiftyBy("owner") } })
            .mockResolvedValueOnce({});
        expect((await invoke(postComment, ev("owner", { id: "p1" }, { text: "ありがとう" }))).statusCode).toBe(200);
        // 数えに行っていないこと自体を見る（数えたら 50 >= 10 で 429 になる）
        expect(commentsGets()).toHaveLength(0);
    });

    it("同じ材料でも、オーナーでなければ 429（上限そのものは効いている）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: fiftyBy("u1") } })
            .mockResolvedValueOnce({ Attributes: { items: fiftyBy("u1") } })
            .mockResolvedValueOnce({});
        expect((await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }))).statusCode).toBe(429);
        expect(commentsGets()).toHaveLength(1);
    });

    it("切り詰めたら commentCount を実数に合わせる", async () => {
        // 足すだけだったので、上限を超えて捨てた分もカウントに残り、
        // モーダルは「250件」、個別ページは「200」と同じ写真に2つの数字が出た。
        const stored = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, uid: "other" }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: [] } })
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        const countUpdate = mockDdbSend.mock.calls[4][0].input;
        expect(countUpdate.UpdateExpression).toBe("SET commentCount = :max");
        expect(countUpdate.ExpressionAttributeValues[":max"]).toBe(200);
    });

    it("切り詰めが書けなかったら、件数は上限値に書き換えない", async () => {
        // 印を先に立てていた頃は、条件が外れて切り詰めが起きなかったのに
        // commentCount だけ 200 に書き換えていた（同時に別の削除が入ると
        // 起きる）。実数とずれたまま残り、モーダルとページで数字が食い違う。
        const stored = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, uid: "other" }));
        const cond = Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: [] } })
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockRejectedValueOnce(cond)      // 切り詰めが競合で外れる
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        const countUpdate = mockDdbSend.mock.calls[4][0].input;
        expect(countUpdate.UpdateExpression).toBe("SET commentCount = if_not_exists(commentCount, :z) + :one");
    });

    it("切り詰めが起きなければ従来どおり +1", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: [] } })
            .mockResolvedValueOnce({ Attributes: { items: [{ id: "c1" }] } })
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        const countUpdate = mockDdbSend.mock.calls[3][0].input;
        expect(countUpdate.UpdateExpression).toContain("if_not_exists(commentCount, :z) + :one");
    });

    it("他人のコメントは自分の上限に数えない", async () => {
        const others = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, uid: `other${i}` }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: others } })
            .mockResolvedValueOnce({ Attributes: { items: others } })
            .mockResolvedValueOnce({});
        expect((await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }))).statusCode).toBe(200);
    });

    // 追記だけだと DynamoDB のアイテム上限(400KB)に達し、以後そのフォトには
    // 誰も二度とコメントできなくなる（縮む経路が無い）。上限で切り詰める。
    it("200件を超えたら古い方を捨てて200件に切り詰める", async () => {
        const stored = Array.from({ length: 201 }, (_, i) => ({
            id: `c${i}`, uid: "u", name: "n", text: "t", t: "2026-01-01",
        }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } }) // photo
            .mockResolvedValueOnce({ Item: { items: [] } })  // 自分のコメント数の確認
            .mockResolvedValueOnce({ Attributes: { items: stored } })                        // append
            .mockResolvedValueOnce({})                                                        // trim
            .mockResolvedValueOnce({});                                                       // count +1

        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));

        const trim = mockDdbSend.mock.calls[3][0].input;
        expect(trim.UpdateExpression).toContain(":trimmed");
        expect(trim.ExpressionAttributeValues[":trimmed"]).toHaveLength(200);
        // 残るのは新しい方（末尾追記なので後ろが新しい）
        expect(trim.ExpressionAttributeValues[":trimmed"][0].id).toBe("c1");
        expect(trim.ExpressionAttributeValues[":trimmed"][199].id).toBe("c200");
    });

    it("切り詰めは「読んだときと同じ長さのまま」を条件にする", async () => {
        // 無条件に書き戻していた頃は、読んでから書くまでに入った投稿が
        // まるごと消えた（投稿者には200が返り画面にも出ているのに、あとで消える）。
        const stored = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}` }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: [] } })  // 自分のコメント数の確認
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        const trim = mockDdbSend.mock.calls[3][0].input;
        expect(trim.ConditionExpression).toBe("size(#items) = :len");
        expect(trim.ExpressionAttributeValues[":len"]).toBe(201);
    });

    it("切り詰めが競合しても投稿自体は成功する（次の投稿が詰める）", async () => {
        const stored = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}` }));
        const conflict = Object.assign(new Error("conflict"), { name: "ConditionalCheckFailedException" });
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: [] } })  // 自分のコメント数の確認
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockRejectedValueOnce(conflict)
            .mockResolvedValueOnce({});
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        expect(res.statusCode).toBe(200);
    });

    it("200件以下なら切り詰めの書き込みをしない", async () => {
        const stored = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: [] } })  // 自分のコメント数の確認
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        // photo get / 自分のコメント数 / append / commentCount+1 の4回だけ
        expect(mockDdbSend).toHaveBeenCalledTimes(4);
    });
});

describe("deleteComment", () => {
    const existing = [{ id: "c1", uid: "author", name: "A", text: "hi", t: "2026-01-01" }];

    it("投稿者本人は削除できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } }) // photo
            .mockResolvedValueOnce({ Item: { items: existing } }) // read comments
            .mockResolvedValueOnce({}) // put
            .mockResolvedValueOnce({}); // count -1
        const res = await invoke(deleteComment, ev("author", { id: "p1", commentId: "c1" }));
        expect(res.statusCode).toBe(200);
    });

    // 削除は `REMOVE #items[i]` で添字を指す。添字は読んだ時点のもので、
    // 読んでから書くまでの間に別のコメントが消えると**ずれる**——
    // 条件が無いと、そのまま**他人のコメントを消す**。
    // 条件式そのものを見ないと、モックの順番で拒否を仕込んでいるだけでは
    // 実装から条件を消しても通ってしまう。
    // 読み側（getComments）には下書き・ストーリー拒否のテストが3本あるのに、
    // 書き側は0本だった。ID さえ分かれば非公開の写真にコメントを付けて
    // オーナーに通知を飛ばせる、という同じ穴。
    it("下書きの写真にはコメントできない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner", published: false } });
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);   // 何も書かない
    });

    it("ストーリーにはコメントできない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/s.jpg", userId: "owner", story: true } });
        const res = await invoke(postComment, ev("u1", { id: "story-1" }, { text: "hi" }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("消す対象が本当にそれかを条件で確かめる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: existing } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(deleteComment, ev("author", { id: "p1", commentId: "c1" }));

        const remove = mockDdbSend.mock.calls
            .map((c) => c[0])
            .find((cmd) => String(cmd.input?.UpdateExpression ?? "").startsWith("REMOVE #items["));
        expect(remove).toBeDefined();
        const idx = /REMOVE #items\[(\d+)\]/.exec(String(remove.input.UpdateExpression))?.[1];
        expect(remove.input.ConditionExpression).toBe(`#items[${idx}].id = :cid`);
        expect(remove.input.ExpressionAttributeValues[":cid"]).toBe("c1");
    });

    it("写真オーナーは他人のコメントを削除できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: existing } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        const res = await invoke(deleteComment, ev("owner", { id: "p1", commentId: "c1" }));
        expect(res.statusCode).toBe(200);
    });

    it("第三者は 403", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: existing } });
        const res = await invoke(deleteComment, ev("stranger", { id: "p1", commentId: "c1" }));
        expect(res.statusCode).toBe(403);
    });

    it("存在しないコメントは 404", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: existing } });
        const res = await invoke(deleteComment, ev("author", { id: "p1", commentId: "nope" }));
        expect(res.statusCode).toBe(404);
    });
});


// **1人あたりの上限が並行リクエストで無効化されていた。**
// 「読んで数える → 無条件に list_append」だったので、同時に投げれば全部が
// 「既存0件」を読んで全部通る。COMMENTS_MAX(200) のリングは自分のコメント
// だけで埋まり、**他人の写真のコメント欄を1回のバーストで全消しできる**
// ——COMMENTS_MAX_PER_USER を入れた理由が並行実行で戻っていた。
// 仕掛けは切り詰めと同じ「読んだときと同じ長さのままなら書く」。
describe("コメント追記: 読みと書きを条件でつなぐ", () => {
    it("追記は「読んだときと同じ長さ」を条件にする", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "s", userId: "owner" } });
                return Promise.resolve({ Item: { items: [{ id: "c1", uid: "someone", text: "x", t: "" }] } });
            }
            return Promise.resolve({ Attributes: { items: [] } });
        });
        const res = await invoke(postComment, ev("me", { id: "p1" }, { text: "こんにちは" }));
        expect(res.statusCode).toBe(200);

        const update = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .find((c) => c.constructor.name === "UpdateCommand"
                && String((c.input.Key as { id?: string })?.id ?? "").startsWith("comments#"));
        expect(update!.input.ConditionExpression).toContain("size(#items) = :len");
        expect((update!.input.ExpressionAttributeValues as Record<string, unknown>)[":len"]).toBe(1);
    });

    it("文書がまだ無い回も通す（attribute_not_exists を併記）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "s", userId: "owner" } });
                return Promise.resolve({});   // コメント文書なし
            }
            return Promise.resolve({ Attributes: { items: [] } });
        });
        await invoke(postComment, ev("me", { id: "p1" }, { text: "はじめて" }));

        const update = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .find((c) => c.constructor.name === "UpdateCommand"
                && String((c.input.Key as { id?: string })?.id ?? "").startsWith("comments#"));
        expect(update!.input.ConditionExpression).toContain("attribute_not_exists(#items)");
    });

    // 諦めたことを黙って飲むと、200 が返って画面には出るのに、あとで消える
    it("やり直しても競合し続けたら 409（200 を返さない）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "s", userId: "owner" } });
                return Promise.resolve({ Item: { items: [] } });
            }
            if (cmd.constructor.name === "UpdateCommand"
                && String((cmd.input.Key as { id?: string })?.id ?? "").startsWith("comments#")) {
                return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        const res = await invoke(postComment, ev("me", { id: "p1" }, { text: "ぶつかる" }));
        expect(res.statusCode).toBe(409);
    });

    // 上限の対象外なので条件も読み取りも要らない（既存の最適化を壊さない）
    it("オーナーの追記には条件を付けない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve({ Item: { id: "p1", src: "s", userId: "me" } });
            }
            return Promise.resolve({ Attributes: { items: [] } });
        });
        await invoke(postComment, ev("me", { id: "p1" }, { text: "ありがとう" }));

        const update = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .find((c) => c.constructor.name === "UpdateCommand"
                && String((c.input.Key as { id?: string })?.id ?? "").startsWith("comments#"));
        expect(update!.input.ConditionExpression).toBeUndefined();
    });
});


// **やり直しの経路そのものが1本も測られていなかった**（レビューが実測:
// やり直し回数を0にしても、読み直しをやめても、34本とも通った）。
describe("コメント追記: ぶつかったらやり直す", () => {
    /** 1回目の追記だけ競合させる世界 */
    function conflictOnce(itemsByRead: Comment[][]) {
        let reads = 0;
        let appends = 0;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "s", userId: "owner" } });
                const items = itemsByRead[Math.min(reads++, itemsByRead.length - 1)];
                return Promise.resolve({ Item: { items } });
            }
            if (cmd.constructor.name === "UpdateCommand"
                && String((cmd.input.Key as { id?: string })?.id ?? "").startsWith("comments#")) {
                appends++;
                if (appends === 1) {
                    return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
                }
                return Promise.resolve({ Attributes: { items: [] } });
            }
            return Promise.resolve({});
        });
        return { get appends() { return appends; } };
    }

    const other = (id: string): Comment =>
        ({ id, uid: "someone", name: "誰か", text: "x", t: "" }) as Comment;

    it("2回目で通る（読み直した長さで条件を組み直す）", async () => {
        const st = conflictOnce([[other("c1")], [other("c1"), other("c2")]]);
        const res = await invoke(postComment, ev("me", { id: "p1" }, { text: "やりなおし" }));

        expect(res.statusCode).toBe(200);
        expect(st.appends).toBe(2);
        const lens = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .filter((c) => c.constructor.name === "UpdateCommand"
                && String((c.input.Key as { id?: string })?.id ?? "").startsWith("comments#"))
            .map((c) => (c.input.ExpressionAttributeValues as Record<string, unknown>)[":len"]);
        // 1回目は1件、2回目は読み直した2件で組み直す
        expect(lens).toEqual([1, 2]);
    });

    it("やり直しの読みは強整合（競合直後に古い値を読み続けない）", async () => {
        conflictOnce([[other("c1")], [other("c1"), other("c2")]]);
        await invoke(postComment, ev("me", { id: "p1" }, { text: "やりなおし" }));

        const commentGets = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .filter((c) => c.constructor.name === "GetCommand"
                && String((c.input.Key as { id?: string })?.id ?? "").startsWith("comments#"));
        expect(commentGets[0].input.ConsistentRead).toBeUndefined();   // 1回目は既定のまま
        expect(commentGets[1].input.ConsistentRead).toBe(true);        // やり直しだけ強整合
    });

    // 追記がサーバー側では成功したのに応答が失われると、SDK が自前で再送し、
    // 再送は条件に外れて ConditionalCheckFailedException で返る。気づかずに
    // やり直すと**同じ id のコメントが2件入る**（消すのに2回要る）。
    it("前回の追記が通っていたら、もう足さない", async () => {
        let reads = 0;
        let appends = 0;
        let mine: Comment | undefined;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "s", userId: "owner" } });
                reads++;
                // 2回目の読みでは、自分のコメントが既に入っている
                return Promise.resolve({ Item: { items: reads === 1 ? [] : [mine] } });
            }
            if (cmd.constructor.name === "UpdateCommand"
                && String((cmd.input.Key as { id?: string })?.id ?? "").startsWith("comments#")) {
                appends++;
                // 応答は失われたが、サーバーには入った
                mine = ((cmd.input.ExpressionAttributeValues as Record<string, unknown>)[":new"] as Comment[])[0];
                return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        const res = await invoke(postComment, ev("me", { id: "p1" }, { text: "一度だけ" }));

        expect(res.statusCode).toBe(200);
        expect(appends).toBe(1);   // 2回目は投げない
    });
});


// 所有者の判定は `userId ?? uploadedBy`。**ここだけフォールバックが無かった。**
// photoUpdate.ts の2か所と deleteComment は持っていて、「userId が無い写真は
// uploadedBy で判定する」専用テストまである。無いと、`uploadedBy` しか持たない
// 古い写真の**本人が11件目で 429** になる——免除を入れた理由そのもの。
describe("コメント上限の免除: 古い写真の所有者", () => {
    /** 自分が10件書き終えている状態の世界 */
    function worldWith(photoAttrs: Record<string, unknown>) {
        const mine = Array.from({ length: 10 }, (_, i) =>
            ({ id: `c${i}`, uid: "me", name: "自分", text: "x", t: "" }));
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string })?.id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "s", ...photoAttrs } });
                return Promise.resolve({ Item: { items: mine } });
            }
            return Promise.resolve({ Attributes: { items: mine } });
        });
    }

    it("uploadedBy しか無い写真でも、本人は上限の対象外", async () => {
        worldWith({ uploadedBy: "me" });
        const res = await invoke(postComment, ev("me", { id: "p1" }, { text: "11件目" }));
        expect(res.statusCode).toBe(200);
    });

    it("userId がある写真は今までどおり（本人は対象外）", async () => {
        worldWith({ userId: "me" });
        expect((await invoke(postComment, ev("me", { id: "p1" }, { text: "11件目" }))).statusCode).toBe(200);
    });

    it("他人は uploadedBy でも上限に当たる", async () => {
        worldWith({ uploadedBy: "someone-else" });
        const res = await invoke(postComment, ev("me", { id: "p1" }, { text: "11件目" }));
        expect(res.statusCode).toBe(429);
    });
});


// **退会してもコメントが公開のまま残っていた。**
// このAPIは未認証で読めるのに投稿者の生死を見ていなかったので、退会したあとも
// 本文と表示名が誰でも読めた。退会でプロフィールは墓石になるのに、コメント
// だけ取り残される形。掃除役（全 Scan）は別枠なので、読むときに伏せる。
describe("getComments: 退会した人の名前は出さない", () => {
    const publicPhoto = { Item: { src: "https://cdn/p1.jpg", published: true } };
    const items = [
        { id: "c1", uid: "gone", name: "やめた人", text: "こんにちは", t: "2026-01-01" },
        { id: "c2", uid: "alive", name: "居る人", text: "やあ", t: "2026-01-02" },
    ];
    const world = () => {
        mockDdbSend.mockResolvedValueOnce(publicPhoto);
        mockDdbSend.mockResolvedValueOnce({ Item: { items } });
    };

    it("退会した人は名前を伏せて印を付ける", async () => {
        mockDeletedIds.mockResolvedValue(new Set(["gone"]));
        world();
        const data = JSON.parse((await invoke(getComments, ev(undefined, { id: "p1" }))).body);

        const c1 = data.items.find((c: { id: string }) => c.id === "c1");
        expect(c1.name).toBe("退会したユーザー");
        expect(c1.deleted).toBe(true);
        // 本文は残る（消すのは掃除役の仕事）
        expect(c1.text).toBe("こんにちは");
        // uid は伏せない（/users/<sub> は公開ルートで、sub は秘密ではない）
        expect(c1.uid).toBe("gone");
    });

    it("生きている人はそのまま", async () => {
        mockDeletedIds.mockResolvedValue(new Set(["gone"]));
        world();
        const data = JSON.parse((await invoke(getComments, ev(undefined, { id: "p1" }))).body);

        const c2 = data.items.find((c: { id: string }) => c.id === "c2");
        expect(c2.name).toBe("居る人");
        expect(c2.deleted).toBeUndefined();
    });

    // ここが押さえているのは「集合が空なら誰も伏せない」まで。
    // deletedUserIds は丸ごとモックなので、**引けなかったときの挙動は
    // ここでは通らない**（本体の fail-open は notify.test.ts
    // 「引けなかったら空集合（投げない・控えもしない）」が押さえている）。
    it("墓石が1件も無ければ、誰も伏せない", async () => {
        mockDeletedIds.mockResolvedValue(new Set<string>());
        world();
        const data = JSON.parse((await invoke(getComments, ev(undefined, { id: "p1" }))).body);

        expect(data.items.every((c: { deleted?: boolean }) => c.deleted === undefined)).toBe(true);
    });

    // 公開APIなので、無駄な読み取りを増やさない
    it("コメントが無ければ引きに行かない", async () => {
        mockDdbSend.mockResolvedValueOnce(publicPhoto);
        mockDdbSend.mockResolvedValueOnce({});
        await invoke(getComments, ev(undefined, { id: "p1" }));
        expect(mockDeletedIds).not.toHaveBeenCalled();
    });
});
