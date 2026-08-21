import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockLookup = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../notify", () => ({
    pushNotification: mockPush,
    lookupDisplayName: mockLookup,
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
