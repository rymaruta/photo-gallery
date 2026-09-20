import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const mockIsBlocked = vi.hoisted(() => vi.fn(async () => false));
// **ブロックは境界としてモックする**（既定は「していない」）。
// 実際の判定は `block.test.ts` が見る。ここで本物を通すと、
// 全テストのモックに `block#` の分岐を足して回ることになり、
// **本題と関係のない行が増えて読めなくなる**。
// ブロックが効くことは、このファイルの専用のテストで見る。
vi.mock("../blockCheck", () => ({
    isBlocked: (...a: unknown[]) => mockIsBlocked(...(a as [])),
    blockMarkerId: (a: string, b: string) => `block#${a}#${b}`,
}));

// **一覧の書き込みは境界としてモックする**（`blockCheck` と同じ判断）。
// `updateUserList` は ddb を自分で叩くので、本物を通すとこのファイルの
// 位置指定のモック列（Put → Update …）に読み書きが割り込み、
// **本題と関係ない行を全テストに足して回る**ことになる。
// あの関数そのものは `userList.test.ts` が見る。
const mockUpdateUserList = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
const mockReadUserList = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => [] as string[]));
vi.mock("../userList", () => ({
    updateUserList: (...a: unknown[]) => mockUpdateUserList(...(a as [])),
    readUserList: (...a: unknown[]) => mockReadUserList(...(a as [])),
    UserListError: class extends Error {},
}));

const { getLikeCount, getMyLike, getMyLikes, likePhoto, unlikePhoto } = await import("../likes");

/** `noteLiked` が渡した mutate を、渡された現在のリストに当てて結果を見る */
function listCalls() {
    return mockUpdateUserList.mock.calls.map((c) => {
        const [rowId, uid, max, mutate] = c as unknown as [string, string, number, (l: string[]) => string[] | null];
        return { rowId, uid, max, mutate };
    });
}

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, id: string | undefined) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id ? { id } : undefined,
    };
}

function condFail() {
    return Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
}

// `mockReset()` は**モック自身を返す**ので、アローの暗黙の return だと
// **vitest が後片付けの関数だと思って引数なしで呼ぶ**（`block.test.ts` 参照）。
// 中括弧で包んで何も返さない。
beforeEach(() => { mockDdbSend.mockReset(); mockUpdateUserList.mockReset(); mockReadUserList.mockReset().mockResolvedValue([]); });

describe("getLikeCount", () => {
    it("id なしは 400", async () => {
        expect((await invoke(getLikeCount, ev("u1", undefined))).statusCode).toBe(400);
    });

    it("写真の likes を返す（未設定・負値は 0）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 5 } });
        expect(JSON.parse((await invoke(getLikeCount, ev(undefined, "p1"))).body)).toEqual({ likes: 5 });

        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg" } });
        expect(JSON.parse((await invoke(getLikeCount, ev(undefined, "p2"))).body)).toEqual({ likes: 0 });

        // 「負値は 0」と名乗っておきながら、負値を一度も渡していなかった。
        // 過去の引きすぎで負になったデータが表示に出ないことを確かめる。
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: -2 } });
        expect(JSON.parse((await invoke(getLikeCount, ev(undefined, "p3"))).body)).toEqual({ likes: 0 });
    });
});

// 「自分がいいね済みか」をサーバーに聞く口。
// これが無かった頃、フロントは端末のお気に入り（localStorage）だけで
// 判断していた。未ログインで押した状態のままログインすると、次の一押しが
// DELETE になって取り消し扱いになり、投稿者にいいねも通知も届かない。
// 別の端末では逆に、いいね済みの写真が未いいねに見える。
describe("getMyLike", () => {
    it("マーカーがあれば liked=true", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "like#p1#u1" } });
        const res = await invoke(getMyLike, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true });
        expect((mockDdbSend.mock.calls[0][0] as { input: { Key: { id: string } } }).input.Key.id)
            .toBe("like#p1#u1");
    });

    it("マーカーが無ければ liked=false", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect(JSON.parse((await invoke(getMyLike, ev("u1", "p1"))).body)).toEqual({ liked: false });
    });

    it("共有キャッシュには載せない（他人の状態が配られるため）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await invoke(getMyLike, ev("u1", "p1")) as unknown as {
            headers: Record<string, string>;
        };
        expect(res.headers["Cache-Control"]).toContain("no-store");
        expect(res.headers["Cache-Control"]).not.toContain("public");
    });

    it("認証・id なしは 400", async () => {
        expect((await invoke(getMyLike, ev(undefined, "p1"))).statusCode).toBe(400);
        expect((await invoke(getMyLike, ev("u1", undefined))).statusCode).toBe(400);
    });
});

describe("likePhoto", () => {
    it("認証・id なしは 400", async () => {
        expect((await invoke(likePhoto, ev(undefined, "p1"))).statusCode).toBe(400);
        expect((await invoke(likePhoto, ev("u1", undefined))).statusCode).toBe(400);
    });

    it("初回いいね: マーカー作成 + カウンタ+1、新しい数を返す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 3 } }); // Update +1
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true, likes: 3 });
        // マーカー id が like#p1#u1
        const put = mockDdbSend.mock.calls[0][0] as { input: { Item: { id: string; uid: string; userId?: string } } };
        expect(put.input.Item.id).toBe("like#p1#u1");
        expect(put.input.Item.uid).toBe("u1");
        expect(put.input.Item.userId).toBeUndefined(); // GSI を汚さない
    });

    it("いいねの条件式は「写真であること」まで確かめる", async () => {
        // attribute_exists(src) が無かった頃は、同じテーブルに同居している
        // 通知（notifs#<相手のsub>）やコメント（comments#<写真ID>）の文書にも
        // likes 属性を書き込めた。ID を当てられるかどうかの確認にも使えた。
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Attributes: { likes: 1 } });
        await invoke(likePhoto, ev("u1", "p1"));
        const update = mockDdbSend.mock.calls[1][0] as { input: { ConditionExpression: string } };
        expect(update.input.ConditionExpression).toContain("attribute_exists(src)");
        expect(update.input.ConditionExpression).toContain("attribute_not_exists(story)");
        // 下書きも弾く。この節が無かった頃は「IDさえ分かれば非公開の写真に
        // いいねを付けてオーナーに通知を飛ばせた」——ソースのコメントが
        // 直したと書いている当のものなのに、見張りが無かった。
        expect(update.input.ConditionExpression).toContain("published = :pub");
        expect(update.input.ExpressionAttributeValues[":pub"]).toBe(true);
    });

    it("いいね済み（マーカー重複）は冪等に現在数を返す（カウンタ増やさない）", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail()) // Put marker → 既存
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 7 } }); // readLikeCount
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true, likes: 7 });
        expect(mockDdbSend).toHaveBeenCalledTimes(2); // Update されない
    });

    it("初回いいねで投稿者に通知が積まれる（byName は Users テーブルから）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1, userId: "owner", src: "https://c/p.jpg", thumbSrc: "https://c/p_thumb.webp", location: "北海道" } }) // Update ALL_NEW
            .mockResolvedValueOnce({ Item: { displayName: "旅子" } }) // lookupDisplayName
            .mockResolvedValueOnce({}); // pushNotification
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(4);
        const notif = mockDdbSend.mock.calls[3][0] as { input: { Key: { id: string }; ExpressionAttributeValues: Record<string, unknown> } };
        expect(notif.input.Key.id).toBe("notifs#owner");
        const item = (notif.input.ExpressionAttributeValues[":new"] as Array<Record<string, unknown>>)[0];
        expect(item.type).toBe("like");
        expect(item.byName).toBe("旅子");
        expect(item.photoSrc).toBe("https://c/p_thumb.webp"); // サムネ優先
        expect(item.atLocation).toBe("北海道");
    });

    // **`userId` が入る前に保存された行は `uploadedBy` しか持たない。**
    // 所有者の判定はこのリポジトリ全体で `userId ?? uploadedBy` に揃っている
    // のに、通知の宛先だけ `userId` 単独だった＝古い写真にいいねしても
    // **投稿者のベルに何も来ない**（押した側には 200 が返るので気づけない）。
    // `ReturnValues: "ALL_NEW"` は射影の影響を受けないので `uploadedBy` は返る。
    it("uploadedBy しか無い古い写真でも、投稿者に通知が積まれる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1, uploadedBy: "old-owner", src: "https://c/p.jpg" } })
            .mockResolvedValueOnce({ Item: { displayName: "旅子" } }) // lookupDisplayName
            .mockResolvedValueOnce({}); // pushNotification
        expect((await invoke(likePhoto, ev("u1", "p1"))).statusCode).toBe(200);
        expect(mockDdbSend, "古い写真だと通知が飛ばない").toHaveBeenCalledTimes(4);
        const notif = mockDdbSend.mock.calls[3][0] as { input: { Key: { id: string } } };
        expect(notif.input.Key.id).toBe("notifs#old-owner");
    });

    // **順番も固定する。** `userId ?? uploadedBy` であって逆ではない
    // （両方持つ行で値が違うと、逆順は別人に通知を送る）。
    // 入れ替える変異が全緑だったので足した
    it("両方あるときは userId を採る（uploadedBy ではない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Attributes: { likes: 1, userId: "now", uploadedBy: "then", src: "https://c/p.jpg" } })
            .mockResolvedValueOnce({ Item: { displayName: "旅子" } })
            .mockResolvedValueOnce({});
        await invoke(likePhoto, ev("u1", "p1"));
        const notif = mockDdbSend.mock.calls[3][0] as { input: { Key: { id: string } } };
        expect(notif.input.Key.id, "優先順位が逆").toBe("notifs#now");
    });

    // 逆向き。自分の写真には鳴らさない（`uploadedBy` 側でも同じ）
    it("自分の写真なら uploadedBy でも通知しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Attributes: { likes: 1, uploadedBy: "u1", src: "https://c/p.jpg" } });
        expect((await invoke(likePhoto, ev("u1", "p1"))).statusCode).toBe(200);
        expect(mockDdbSend, "自分のいいねで自分に通知している").toHaveBeenCalledTimes(2);
    });

    it("自分の写真へのいいねは通知しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1, userId: "u1", src: "https://c/p.jpg" } }); // 自分が投稿者
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(2); // 通知の書き込みなし
    });

    it("いいね済み（連打）では通知されない", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail()) // マーカー既存
            .mockResolvedValueOnce({ Item: { likes: 7 } });
        await invoke(likePhoto, ev("u1", "p1"));
        expect(mockDdbSend).toHaveBeenCalledTimes(2); // 通知の書き込みなし
    });

    it("通知の書き込み失敗はいいね自体を失敗させない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1, userId: "owner", src: "https://c/p.jpg" } })
            .mockRejectedValueOnce(new Error("users table down")) // lookupDisplayName 失敗 → 既定名
            .mockRejectedValueOnce(new Error("notify down")); // pushNotification 失敗 → 握りつぶす
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true, likes: 1 });
    });

    it("写真が存在しない場合はマーカーを巻き戻して 404", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockRejectedValueOnce(condFail()) // Update → attribute_exists 失敗
            .mockResolvedValueOnce({}); // Delete marker（巻き戻し）
        const res = await invoke(likePhoto, ev("u1", "ghost"));
        expect(res.statusCode).toBe(404);
        const del = mockDdbSend.mock.calls[2][0] as { input: { Key: { id: string } } };
        expect(del.input.Key.id).toBe("like#ghost#u1");
    });

    // 巻き戻すのは「増えていないと言い切れる」失敗だけ。
    // どんな失敗でも巻き戻していた頃は、タイムアウト（実際には +1 済み
    // かもしれない）でもマーカーを消していたので、本人が取り消しても
    // マーカーが無くて弾かれ、**誰にも減らせない +1** が公開の数字に残った。
    it("スロットリング（未適用と言い切れる）ならマーカーを巻き戻す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" }))
            .mockResolvedValueOnce({});
        expect((await invoke(likePhoto, ev("u1", "p1"))).statusCode).toBe(500);
        const deletes = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string } })
            .filter((c) => c.constructor.name === "DeleteCommand");
        expect(deletes).toHaveLength(1);
    });

    it("タイムアウト（適用されたか分からない）ではマーカーを消さない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
        expect((await invoke(likePhoto, ev("u1", "p1"))).statusCode).toBe(500);
        const deletes = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string } })
            .filter((c) => c.constructor.name === "DeleteCommand");
        expect(deletes).toHaveLength(0);
    });
});

describe("unlikePhoto", () => {
    it("いいね解除: マーカー削除 + カウンタ-1", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Delete marker
            .mockResolvedValueOnce({ Attributes: { src: "https://cdn/x.jpg", likes: 2 } }); // Update -1（ALL_NEW）
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: false, likes: 2 });
    });

    it("未いいね（マーカーなし）は冪等に現在数を返す", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail()) // Delete marker → 無い
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 4 } });
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: false, likes: 4 });
    });

    it("カウンタが既に0でも 0 未満にならない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Delete marker
            .mockRejectedValueOnce(condFail()) // Update likes>0 失敗
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 0 } });
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: false, likes: 0 });
    });

    it("スロットリング（未適用と言い切れる）ならマーカーを書き戻す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(Object.assign(new Error("throttled"), { name: "ThrottlingException" }))
            .mockResolvedValueOnce({});
        expect((await invoke(unlikePhoto, ev("u1", "p1"))).statusCode).toBe(500);
        const puts = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string } })
            .filter((c) => c.constructor.name === "PutCommand");
        expect(puts).toHaveLength(1);
    });

    it("タイムアウトではマーカーを書き戻さない（二重に減らさない）", async () => {
        // 書き戻すと画面は「いいね済み」に見えるので、本人がもう一度
        // 取り消して二重に減る。実際より小さい数字はいいねし直しても直らない。
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
        expect((await invoke(unlikePhoto, ev("u1", "p1"))).statusCode).toBe(500);
        const puts = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string } })
            .filter((c) => c.constructor.name === "PutCommand");
        expect(puts).toHaveLength(0);
    });
});

// **非公開に戻した写真のいいね数が、未認証で読めた。**
//
// このルートは公開（`serverless.yml`）で、読み取りは `likes` しか見て
// いなかった。存在と人気度が漏れるうえ、「不適切な反応が付いたので
// 非公開にする」が効かない。書き込み側（`likePhoto`）は最初から
// `src` あり・`published !== false`・`story` 無しを条件にしていて、
// `getComments` も同じ理由で同じ判定を入れてある。**読み取りだけ
// 素通しだった。**
describe("公開されていない写真のいいね数は返さない", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ["非公開に戻した写真", { src: "https://cdn/x.jpg", published: false, likes: 9 }],
        ["ストーリー", { src: "https://cdn/x.mp4", story: true, likes: 3 }],
        ["写真ではない行（マーカー等）", { likes: 12 }],
    ];

    it.each(cases)("%s は 404", async (_name, item) => {
        mockDdbSend.mockResolvedValueOnce({ Item: item });
        const res = await invoke(getLikeCount, ev(undefined, "p1"));
        expect(res.statusCode).toBe(404);
        // 数字を漏らさない
        expect(res.body).not.toContain("9");
        expect(res.body).not.toContain("12");
    });

    it("行そのものが無ければ 404", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect((await invoke(getLikeCount, ev(undefined, "p1"))).statusCode).toBe(404);
    });

    // `published` が無い古い行は公開扱い（一覧・書き込み側と同じ）
    it("published が無い古い行は返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 2 } });
        const res = await invoke(getLikeCount, ev(undefined, "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ likes: 2 });
    });

    // 冪等の経路（マーカーが既にある／無い）は条件式を通らないので、
    // 非公開に戻された写真でもここに来られる
    it("いいね済みの冪等経路でも、非公開なら数字を返さない", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", published: false, likes: 7 } });
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain("7");
    });

    // **数字は出せなくても、状態は伝える。**
    //
    // ここに来るのはマーカーが**既にある**経路（`ConditionalCheckFailed`）。
    // `liked` を伝えないと、クライアントは「付かなかった」と読んで画面を
    // 未いいねに戻す——サーバーにはマーカーが残っているので、押し直しても
    // 同じ 404 で**永久に外せない**（解除の DELETE は通るのに、画面が
    // その導線を出さない）。
    it("いいね済みの冪等経路の 404 には liked を添える", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", published: false, likes: 7 } });
        const res = await invoke(likePhoto, ev("u1", "p1"));

        const body = JSON.parse(res.body) as { error?: string; liked?: boolean; likes?: number };
        expect(body.liked, "マーカーが残っているのに、状態を伝えていない").toBe(true);
        expect(body.error, "理由が日本語で入っていない（isGoneResponse が見る）").toBeTruthy();
        expect(body.likes, "数字を出している").toBeUndefined();
    });

    // マーカーが無い側（新規いいね → カウンタ更新が条件で弾かれる）は、
    // マーカーごと戻すので `liked` を添えない
    it("新規いいねが弾かれた 404 には liked を添えない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})                 // マーカー作成は成功
            .mockRejectedValueOnce(condFail())         // カウンタ更新が条件で失敗
            .mockResolvedValueOnce({});                // マーカーの巻き戻し
        const res = await invoke(likePhoto, ev("u1", "p1"));

        expect(res.statusCode).toBe(404);
        expect((JSON.parse(res.body) as { liked?: boolean }).liked,
            "何も残っていないのに「いいね済み」と伝えている").toBeUndefined();
    });
});

// **射影から漏れると判定が死ぬ。**
//
// `readLikeCount` は `ProjectionExpression` で読んだ `src` を見て公開判定
// する。DynamoDB は射影した属性しか返さないので、`src` が式から落ちた瞬間
// `!item.src` が常に真になり、**全写真で 404**（ギャラリーは写真ごとに
// この口を叩く）。しかもフロントは `if (!res.ok) return;` で握るので、
// 画面には**ビルド時の古い数字が出たまま**——気づきにくい壊れ方。
//
// テストのモックは射影を無視して `Item` をそのまま返すため、式を
// `"likes"` に戻しても28件すべて緑のままだった（実測）。
// `follow.test.ts` が同じ形を「実装を消しても通るテストの再発形」として
// 押さえているので、こちらも**式そのものを見る**。
describe("いいね数の読み取りは、判定に使う属性まで射影する", () => {
    it.each(["src", "published", "story", "likes"])("%s が射影に入っている", async (attr) => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 1 } });
        await invoke(getLikeCount, ev(undefined, "p1"));

        const get = mockDdbSend.mock.calls.map((c) => c[0])
            .find((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "GetCommand");
        expect((get as { input: { ProjectionExpression: string } }).input.ProjectionExpression).toContain(attr);
    });
});

// 減算そのものは条件に公開判定を足さない——足すと、非公開になった写真の
// いいねを**本人が永久に取り消せなくなる**。減らしはするが数字は返さない。
describe("非公開に戻された写真のいいね解除", () => {
    it("減らすが、数字は返さない（404）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})   // Delete marker
            .mockResolvedValueOnce({ Attributes: { src: "https://cdn/x.jpg", published: false, likes: 4 } });
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain("4");
        // 減算そのものは走っている（取り消せなくならない）
        expect(mockDdbSend).toHaveBeenCalledTimes(2);
    });

    it("減らすものが無かった経路でも数字を返さない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})            // Delete marker
            .mockRejectedValueOnce(condFail())    // likes > 0 で落ちる
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", published: false, likes: 0 } });
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(404);
    });
});

/**
 * 「自分がいいねした写真」の一覧（`likes#<uid>`）。
 *
 * owner の報告:「いいねした写真を見てもいいねした写真がない」。
 * 原因は**この一覧がサーバーに無かった**こと——画面は端末の localStorage
 * しか見ておらず、別の端末で押したぶんは0件に見えた（同じ写真のページは
 * マーカーを見るので「いいね済み」と出る＝同じアカウントで食い違う）。
 *
 * ⚠️ この一覧は**表示用の索引**。いいね済みかどうかは決めない
 * （決めると、上限で溢れた写真のハートが空に見えて解除が飛ぶ）。
 */
describe("いいねした写真の一覧", () => {
    it("初回いいねで、一覧の先頭に足す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})                              // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1 } });   // Update +1
        await invoke(likePhoto, ev("u1", "p1"));

        const calls = listCalls();
        expect(calls, "一覧を更新していない").toHaveLength(1);
        expect(calls[0].rowId).toBe("likes#u1");
        expect(calls[0].uid).toBe("u1");
        // **新しい順**（先頭に積む）
        expect(calls[0].mutate(["old"])).toEqual(["p1", "old"]);
    });

    it("上限を渡す（際限なく伸びない）", async () => {
        mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({ Attributes: { likes: 1 } });
        await invoke(likePhoto, ev("u1", "p1"));
        expect(listCalls()[0].max).toBeGreaterThan(0);
    });

    it("既に一覧に在れば書き込まない（null を返す）", async () => {
        mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({ Attributes: { likes: 1 } });
        await invoke(likePhoto, ev("u1", "p1"));
        expect(listCalls()[0].mutate(["p1", "x"]), "同じ写真を二重に積んでいる").toBeNull();
    });

    // **マーカーは在るのに一覧に無い**（一覧の書き込みだけ落ちた回）の出口。
    // ここで足し直さないと、ずれた端末から押しても直らない
    it("いいね済みの冪等な POST でも、一覧に足し直す", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail())                                   // Put marker → 既にある
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 4 } }); // readLikeCount
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        const calls = listCalls();
        expect(calls, "冪等経路で足し直していない").toHaveLength(1);
        expect(calls[0].mutate([])).toEqual(["p1"]);
    });

    it("解除すると一覧から外す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})                                                       // Delete marker
            .mockResolvedValueOnce({ Attributes: { likes: 0, src: "https://cdn/x.jpg" } });  // Update -1
        await invoke(unlikePhoto, ev("u1", "p1"));
        const calls = listCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0].rowId).toBe("likes#u1");
        expect(calls[0].mutate(["a", "p1", "b"])).toEqual(["a", "b"]);
        expect(calls[0].mutate(["a", "b"]), "無いのに書き込んでいる").toBeNull();
    });

    // **マーカーを消せていない回（冪等）で外さない。** 外すと、いいねは
    // 残っているのにページから消える
    it("冪等な DELETE（マーカーが無い）では一覧を触らない", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail())                                        // Delete marker → 無い
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", likes: 2 } }); // readLikeCount
        await invoke(unlikePhoto, ev("u1", "p1"));
        expect(listCalls(), "マーカーが無いのに一覧を触っている").toHaveLength(0);
    });

    // マーカーを書き戻すなら一覧も戻す。片方だけ戻すと
    // 「いいね済みなのにページに出ない」が残る
    it("解除の巻き戻し（マーカーを書き戻す）では、一覧も戻す", async () => {
        const throttle = Object.assign(new Error("slow"), { name: "ThrottlingException" });
        mockDdbSend
            .mockResolvedValueOnce({})          // Delete marker
            .mockRejectedValueOnce(throttle)    // Update -1 が未適用と言い切れる失敗
            .mockResolvedValueOnce({});         // Put marker（書き戻し）
        await invoke(unlikePhoto, ev("u1", "p1"));
        const calls = listCalls();
        expect(calls, "外して戻す の2回になっていない").toHaveLength(2);
        expect(calls[0].mutate(["p1"]), "1回目は外す").toEqual([]);
        expect(calls[1].mutate([]), "2回目は戻す").toEqual(["p1"]);
    });

    // **索引1行のために、いいねごと落とさない。** 本体はマーカー・公開の数・通知
    it("一覧の書き込みが落ちても、いいねは成功する", async () => {
        mockUpdateUserList.mockRejectedValue(new Error("boom"));
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Attributes: { likes: 7 } });
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true, likes: 7 });
    });
});

describe("getMyLikes", () => {
    it("自分がいいねした写真のIDを返す", async () => {
        mockReadUserList.mockResolvedValue(["p2", "p1"]);
        const res = await invoke(getMyLikes, ev("u1", undefined));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ photoIds: ["p2", "p1"] });
        expect(mockReadUserList.mock.calls[0][0]).toBe("likes#u1");
    });

    it("未認証は 400", async () => {
        expect((await invoke(getMyLikes, ev(undefined, undefined))).statusCode).toBe(400);
    });

    it("共有キャッシュには載せない（他人の一覧が配られるため）", async () => {
        mockReadUserList.mockResolvedValue([]);
        const res = await invoke(getMyLikes, ev("u1", undefined)) as unknown as { headers: Record<string, string> };
        expect(res.headers["Cache-Control"]).toContain("no-store");
        expect(res.headers["Cache-Control"]).not.toContain("public");
    });

    it("読めなければ 500（0件と混ぜない）", async () => {
        mockReadUserList.mockRejectedValue(new Error("ddb down"));
        expect((await invoke(getMyLikes, ev("u1", undefined))).statusCode).toBe(500);
    });
});
