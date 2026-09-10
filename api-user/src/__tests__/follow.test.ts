import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockLookup = vi.hoisted(() => vi.fn());
const mockLookupIfSet = vi.hoisted(() => vi.fn<(uid: string) => Promise<string | undefined>>(async () => undefined));
const mockDeleted = vi.hoisted(() => vi.fn<() => Promise<Set<string>>>(async () => new Set<string>()));
const mockIsBlocked = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../notify", () => ({
    pushNotification: mockPush,
    lookupDisplayName: mockLookup,
    lookupDisplayNameIfSet: (...a: unknown[]) => mockLookupIfSet(...(a as [string])),
    deletedUserIds: () => mockDeleted(),
}));
// **境界として差し替える。** 素で通すと、この画面のほとんどのテストが
// 使っている「`mockDdbSend` に順番どおり答えさせる」形が1つずつずれる
// （判定の GetItem が2本増えるため）。ブロックそのものの振る舞いは
// `block.test.ts` と、下の専用の describe で見る。
vi.mock("../blockCheck", () => ({ isBlocked: mockIsBlocked }));

vi.stubEnv("USERS_TABLE", "users-test");
const { followUser, unfollowUser, getFollowStats, getMyFollowing, getUserFollowing, getUserFollowers } = await import("../follow");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

// Cognito の sub は UUID。でたらめな文字列は弾かれるようになったので、
// テストでも実際の形に合わせる。
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

function ev(sub: string | undefined, uid: string | undefined) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: uid ? { uid } : undefined,
    };
}
function condFail() {
    return Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
}

/**
 * マーカーとカウンタは1つのトランザクションで書く。
 * 「マーカーの条件が外れた」＝既にフォロー済み / 既に未フォロー、を
 * この形で伝える（api-user/src/account.ts と同じ扱い）。
 */
function txCancelled(codes: string[]) {
    return Object.assign(new Error("cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: codes.map((Code) => ({ Code })),
    });
}
/** 送られたトランザクションの中身（Put/Delete/Update の配列）を取り出す */
type TxItem = {
    Put?: { Item?: { id?: string }; ConditionExpression?: string };
    Delete?: { Key?: { id?: string }; ConditionExpression?: string };
    Update?: { Key?: { id?: string }; UpdateExpression?: string; ConditionExpression?: string };
};
function transactItems(): TxItem[][] {
    return mockDdbSend.mock.calls
        .map((c) => c[0])
        .filter((cmd) => cmd?.constructor?.name === "TransactWriteCommand")
        .map((cmd) => cmd.input.TransactItems as TxItem[]);
}
/** トランザクション以外の単発コマンド（打ち消しの最後の手段を見るため） */
function commandsNamed(name: string): { input: Record<string, unknown> }[] {
    return mockDdbSend.mock.calls
        .map((c) => c[0])
        .filter((cmd) => cmd?.constructor?.name === name);
}

/**
 * followUser は最初に「相手が実在するか」を USERS_TABLE に聞く。
 * その応答を先頭に積んでから、テスト固有の応答を続ける。
 */
function queueUserExists() {
    mockDdbSend.mockResolvedValueOnce({ Item: { userId: OTHER } });
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockPush.mockReset().mockResolvedValue(undefined);
    mockLookup.mockReset().mockResolvedValue("旅人A");
    mockIsBlocked.mockReset().mockResolvedValue(false);
    mockLookupIfSet.mockReset().mockResolvedValue(undefined);
    mockDeleted.mockReset().mockResolvedValue(new Set<string>());
});

describe("followUser", () => {
    it("自分をフォローは 400", async () => {
        expect((await invoke(followUser, ev(ME, ME))).statusCode).toBe(400);
    });

    it("認証なしは 400", async () => {
        expect((await invoke(followUser, ev(undefined, OTHER))).statusCode).toBe(400);
    });

    // 形も存在も見ていなかったので、でたらめなIDを投げるだけで
    // マーカー・カウンタ・通知文書の3つが作られた。このテーブルは
    // 公開一覧やストーリー掃除が端から端まで読むので、ゴミが増えるほど
    // 全員の表示が遅くなる。しかも通知文書は退会処理でも消えない。
    it("ユーザーIDの形でない相手は 400（何も書かない）", async () => {
        const res = await invoke(followUser, ev(ME, "not-a-uuid"));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("実在しない相手は 404（何も書かない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})              // USERS_TABLE に行が無い
            .mockResolvedValueOnce({ Count: 0 });   // 写真も無い（行が無い人の救済）
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(404);
        // 確認の2回だけ（users 行 → 写真）。書き込みは1つも無い
        expect(mockDdbSend).toHaveBeenCalledTimes(2);
        expect(transactItems()).toHaveLength(0);
        expect(mockPush).not.toHaveBeenCalled();
    });

    // 以前は「判定できないときは通す」だった（fail-open）。USERS_TABLE が
    // スロットルされている間は、存在しない UUID でもマーカー・カウンタ・
    // 通知文書の3つが作られた。「居ない（404）」と「確認できなかった（503）」を
    // 混ぜずに、分からないなら止める（押し直せば通る）。
    it("実在を確認できなければ 503（何も書かない・404と混ぜない）", async () => {
        mockDdbSend.mockImplementationOnce(() => Promise.reject(new Error("throttled")));
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body).error).toContain("確認できませんでした");
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // 確認の1回だけ。マーカーは書かない
        expect(mockPush).not.toHaveBeenCalled();
    });

    // **ブロックしたのに、相手のワンタップで関係が戻っていた。**
    // `blockUser` は両向きのフォローを切るのに、この口には判定が
    // 1つも無かった（`isBlocked` の呼び出しは stories / storyReplies /
    // notify / comments の4か所だけで、follow.ts には0件）。
    // しかも `notify.ts` がフォロー通知を握るので、**ブロックした側は
    // 気づけない**——フォロワー数だけが増える。
    it("相手にブロックされていたら 404（実在も確かめず、何も書かない）", async () => {
        mockIsBlocked.mockImplementation((blocker: string) => Promise.resolve(blocker === OTHER));
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(404);
        // **ブロックの事実を教えない**（`storyReplies` と同じ倒し方）
        expect(JSON.parse(res.body).error).not.toContain("ブロック");
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(transactItems()).toHaveLength(0);
        expect(mockPush).not.toHaveBeenCalled();
    });

    // 自分がやったことなので隠す意味が無い。404 にすると
    // 「消えた人」に見えて、解除すれば直ることが伝わらない
    it("自分がブロックしている相手は 400 で理由を言う（何も書かない）", async () => {
        mockIsBlocked.mockImplementation((blocker: string) => Promise.resolve(blocker === ME));
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toContain("解除");
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    // 「分からない」を素通ししない。fail-open にすると、
    // DynamoDB が詰まっている間だけブロックが効かなくなる
    it("ブロックを確認できなければ 503（何も書かない）", async () => {
        mockIsBlocked.mockRejectedValue(new Error("throttled"));
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(503);
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    // 判定は2回とも要る（向きが違う）。往復を増やさないため同時に投げる
    it("ブロックされていなければ、判定は両向き1回ずつで通る", async () => {
        queueUserExists();
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { list: [] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);
        expect(mockIsBlocked.mock.calls).toEqual([[OTHER, ME], [ME, OTHER]]);
    });

    it("同じ相手を繰り返しフォローしても通知は積まない", async () => {
        // 解除するとマーカーが消えるので、フォロー→解除の繰り返しで
        // 通知を何度でも積めた。通知は50件の輪なので、100回ほどで
        // 相手の通知欄を自分の通知だけで埋め尽くせる
        // （読んでいないいいね・コメントの知らせが全部消える）。
        queueUserExists();
        mockDdbSend
            .mockResolvedValueOnce({})                              // トランザクション
            .mockResolvedValueOnce({ Item: { list: [] } })          // readFollowing
            .mockResolvedValueOnce({})                              // Put following list
            .mockRejectedValueOnce(condFail())                      // 通知の間引き（直近に通知済み）
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("初回フォロー: マーカーとカウンタを1つの書き込みで作る", async () => {
        queueUserExists();
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { list: [] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})                              // 通知の間引き（通す）
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } });
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ following: true, followers: 1 });
        expect(mockPush).toHaveBeenCalledTimes(1);

        // **1つの書き込みであること**が肝。別々だと、片方だけ効いた状態が残る。
        const tx = transactItems();
        expect(tx).toHaveLength(1);
        expect(tx[0]).toHaveLength(3);
        expect(tx[0][0].Put?.Item?.id).toBe(`follow#${OTHER}#${ME}`);
        expect(tx[0][1].Update?.Key?.id).toBe(`followstats#${OTHER}`);
        expect(tx[0][2].Update?.Key?.id).toBe(`followstats#${ME}`);
    });

    // 失敗しうる条件を1つに絞ってある（マーカーだけ）。
    // 加算に条件を付けると「マーカーは作れたがカウンタは増やせない」
    // 組み合わせが生まれ、キャンセル理由の分岐が増える——
    // account.ts を5回作り直した原因がそれだった。
    it("条件を持つのはマーカーだけ（加算には付けない）", async () => {
        queueUserExists();
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { list: [] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } });
        await invoke(followUser, ev(ME, OTHER));

        const items = transactItems()[0];
        expect(items[0].Put?.ConditionExpression).toBe("attribute_not_exists(id)");
        expect(items[1].Update?.ConditionExpression).toBeUndefined();
        expect(items[2].Update?.ConditionExpression).toBeUndefined();
    });

    // 「1つの書き込みか」「条件が付いているか」だけを見ていて、
    // **向き（+1 か -1 か）とどのフィールドを触るか**を一度も確かめて
    // いなかった。`+ :one` を `- :one` に変えても、followers と following を
    // 入れ替えても、テストは全部通っていた——「フォロワー数が永久に
    // ずれるのを直す」というコミットで、いちばん肝心な部分が無検証だった。
    it("加算は増やす向きで、相手は followers・自分は following を触る", async () => {
        queueUserExists();
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { list: [] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } });
        await invoke(followUser, ev(ME, OTHER));

        const items = transactItems()[0];
        expect(items[1].Update?.Key?.id).toBe(`followstats#${OTHER}`);
        expect(items[1].Update?.UpdateExpression)
            .toBe("SET followers = if_not_exists(followers, :z) + :one, uid = :uid");
        expect(items[2].Update?.Key?.id).toBe(`followstats#${ME}`);
        expect(items[2].Update?.UpdateExpression)
            .toBe("SET following = if_not_exists(following, :z) + :one, uid = :uid");
    });

    it("既にフォロー済みは冪等（カウンタ・通知なし）", async () => {
        queueUserExists();
        mockDdbSend
            .mockRejectedValueOnce(txCancelled(["ConditionalCheckFailed", "None", "None"]))
            .mockResolvedValueOnce({ Item: { list: [OTHER] } })     // readFollowing（既に居る）
            .mockResolvedValueOnce({ Item: { followers: 3, following: 0 } }); // readStats
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).followers).toBe(3);
        expect(mockPush).not.toHaveBeenCalled();
        // 一覧に既に居るなら書き込みは増やさない
        expect(transactItems()).toHaveLength(1);
    });

    // 「マーカーはあるが一覧に無い」を押し直しで直せるようにしておく。
    // 冪等の道で早期 return していた頃は、ここが**二度と直らなかった**
    // ——画面は一覧から作るのでボタンは「フォロー」のまま、押しても
    // 「既にフォロー済み」で返るだけで一覧は書かれない。
    // これがあるので、打ち消しが取れなくても行き止まりにならない。
    it("マーカーだけあって一覧に無い状態は、押し直しで直る", async () => {
        queueUserExists();
        mockDdbSend
            .mockRejectedValueOnce(txCancelled(["ConditionalCheckFailed", "None", "None"]))
            .mockResolvedValueOnce({ Item: { list: [], rev: 2 } })  // 一覧が欠けている
            .mockResolvedValueOnce({})                              // 一覧の Put
            .mockResolvedValueOnce({ Item: { followers: 3, following: 0 } });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string; list?: string[] } } }).input?.Item)
            .find((i) => i?.id?.startsWith("following#"));
        expect(put?.list).toEqual([OTHER]);
        // 直っただけ。カウンタは動かさない（既に数えられている）
        expect(transactItems()).toHaveLength(1);
        expect(mockPush).not.toHaveBeenCalled();
    });

    // マーカー以外の理由で落ちたときは**何も書かれていない**。
    // 冪等の 200 を返すと「フォロー済み扱いなのにカウンタが増えていない」
    // 状態が固定される（押し直しても早期 return で直らない）。
    it("マーカー以外の理由で撃ち直しても駄目なら 500（冪等扱いにしない）", async () => {
        queueUserExists();
        // 撃ち直す回数ぶん落ちてもらう（TX_ATTEMPTS = 3）
        for (let i = 0; i < 3; i++) {
            mockDdbSend.mockRejectedValueOnce(txCancelled(["None", "TransactionConflict", "None"]));
        }
        // 冪等の道が通れるように readStats の応答も積んでおく。
        // 積まないとモックが尽きて**別の理由で** 500 になり、
        // 判定を潰しても落ちない（今日ずっと直している型）。
        mockDdbSend.mockResolvedValueOnce({ Item: { followers: 3, following: 0 } });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(500);
        expect(mockPush).not.toHaveBeenCalled();
    });

    // TransactionCanceledException は 400 系なので SDK が自動で撃ち直さない。
    // 人気ユーザーの followstats# は全フォロー/解除が触るので
    // TransactionConflict は日常的に起きる。ここで諦めると
    // 「うまくいきませんでした」が出るだけで、押し直せば通る。
    it("競合で落ちたら待って撃ち直す（1回目で諦めない）", async () => {
        queueUserExists();
        mockDdbSend
            .mockRejectedValueOnce(txCancelled(["None", "TransactionConflict", "None"]))
            .mockResolvedValueOnce({})                              // 2回目は通る
            .mockResolvedValueOnce({ Item: { list: [] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);

        // 撃ち直しでは項目を落とさない（借りがあるのは変わらないため）
        const tx = transactItems();
        expect(tx).toHaveLength(2);
        expect(tx[1]).toHaveLength(3);
    });

    it("一覧の更新を諦めたら失敗を返し、マーカーもカウンタも取り消す", async () => {
        queueUserExists();
        mockDdbSend.mockResolvedValueOnce({});                       // フォローのトランザクション
        // 一覧の書き込みは rev 競合のたびに読み直す（4回まで）
        for (let i = 0; i < 4; i++) {
            mockDdbSend
                .mockResolvedValueOnce({ Item: { list: [] } })       // readFollowing
                .mockRejectedValueOnce(condFail());                  // Put（rev 競合）
        }
        mockDdbSend.mockResolvedValueOnce({});                       // 打ち消しのトランザクション
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(500);

        // 打ち消しも1つの書き込みで行う。バラバラだと、打ち消し側で
        // 「片方だけ効いた状態」を作ってしまう。
        const tx = transactItems();
        expect(tx).toHaveLength(2);
        expect(tx[1][0].Delete?.Key?.id).toBe(`follow#${OTHER}#${ME}`);
        expect(tx[1][1].Update?.Key?.id).toBe(`followstats#${OTHER}`);
        expect(tx[1][2].Update?.Key?.id).toBe(`followstats#${ME}`);
    });
});

describe("unfollowUser", () => {
    it("解除もマーカーとカウンタを1つの書き込みで消す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})                              // トランザクション
            .mockResolvedValueOnce({ Item: { list: [OTHER] } })     // readFollowing
            .mockResolvedValueOnce({})                              // Put following list
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        const res = await invoke(unfollowUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(false);

        const tx = transactItems();
        expect(tx).toHaveLength(1);
        expect(tx[0][0].Delete?.Key?.id).toBe(`follow#${OTHER}#${ME}`);
        expect(tx[0][0].Delete?.ConditionExpression).toBe("attribute_exists(id)");
        expect(tx[0][1].Update?.Key?.id).toBe(`followstats#${OTHER}`);
        expect(tx[0][2].Update?.Key?.id).toBe(`followstats#${ME}`);
    });

    it("自分を解除は 400", async () => {
        // 通すと1つのトランザクションが followstats#<自分> を2回触ることになり、
        // DynamoDB が ValidationException で丸ごと拒否する（条件の評価より前
        // なので 500）。followUser 側と同じく入口で断る。
        expect((await invoke(unfollowUser, ev(ME, ME))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // 減算には**床**（`> :z`）と**存在条件**を付ける。一度これを外したが誤り。
    //   - 床が無いと: 既にずれて1少ないカウンタが解除で -1 になり、
    //     次の本物のフォローが 0 に戻すだけ。**その1人分が永久に吸収される**。
    //   - 存在条件が無いと: 退会で消えた followstats# を followers: -1 で
    //     作り直す（GSI に載らないので誰も消せない行が増える）。
    it("減算には床と存在条件を付ける（誤差が増えるのを止める）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { list: [OTHER] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        await invoke(unfollowUser, ev(ME, OTHER));

        const items = transactItems()[0];
        expect(items[1].Update?.ConditionExpression).toBe("attribute_exists(id) AND followers > :z");
        expect(items[2].Update?.ConditionExpression).toBe("attribute_exists(id) AND following > :z");
    });

    it("減算は減らす向きで、相手は followers・自分は following を触る", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { list: [OTHER] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        await invoke(unfollowUser, ev(ME, OTHER));

        const items = transactItems()[0];
        expect(items[1].Update?.Key?.id).toBe(`followstats#${OTHER}`);
        expect(items[1].Update?.UpdateExpression).toBe("SET followers = followers - :one");
        expect(items[2].Update?.Key?.id).toBe(`followstats#${ME}`);
        expect(items[2].Update?.UpdateExpression).toBe("SET following = following - :one");
    });

    // 落とし直しは**再試行の回数を食わない**。食っていた頃は、
    // 数回スロットルされたあとに本当の条件外れが見えると、組み直した
    // 書き込みを**一度も送らずに** `unreachable` で 500 になっていた
    // （しかも本当の DynamoDB のエラーが捨てられるので調べようがない）。
    it("何度か競合したあとに0のカウンタが見えても、組み直して通す", async () => {
        mockDdbSend
            .mockRejectedValueOnce(txCancelled(["ThrottlingError", "ThrottlingError", "ThrottlingError"]))
            .mockRejectedValueOnce(txCancelled(["ThrottlingError", "ThrottlingError", "ThrottlingError"]))
            .mockRejectedValueOnce(txCancelled(["None", "ConditionalCheckFailed", "None"]))
            .mockResolvedValueOnce({})                              // 組み直した2項目
            .mockResolvedValueOnce({ Item: { list: [OTHER] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        expect((await invoke(unfollowUser, ev(ME, OTHER))).statusCode).toBe(200);
        expect(transactItems().map((t) => t.length)).toEqual([3, 3, 3, 2]);
    });

    // 床を付けた代償として「マーカーは消せるがカウンタは減らせない」が
    // 起こりうる。トランザクションは丸ごと拒否されるので、そのままだと
    // **解除できない人**が出る（0 に張り付いたカウンタが解除を永久に塞ぐ）。
    // 減らせない項目だけ落として組み直す。
    it("既に0のカウンタは落として、マーカーと残りは同じ書き込みのまま通す", async () => {
        mockDdbSend
            .mockRejectedValueOnce(txCancelled(["None", "ConditionalCheckFailed", "None"]))
            .mockResolvedValueOnce({})                              // 落として撃ち直し
            .mockResolvedValueOnce({ Item: { list: [OTHER] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        expect((await invoke(unfollowUser, ev(ME, OTHER))).statusCode).toBe(200);

        const tx = transactItems();
        expect(tx).toHaveLength(2);
        // 減らせなかった相手のカウンタだけが消え、マーカーと自分のぶんは残る
        expect(tx[1]).toHaveLength(2);
        expect(tx[1][0].Delete?.Key?.id).toBe(`follow#${OTHER}#${ME}`);
        expect(tx[1][1].Update?.Key?.id).toBe(`followstats#${ME}`);
    });

    it("フォローしていなければ冪等", async () => {
        mockDdbSend
            .mockRejectedValueOnce(txCancelled(["ConditionalCheckFailed", "None", "None"]))
            .mockResolvedValueOnce({ Item: { list: [] } })          // readFollowing（既に居ない）
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        const res = await invoke(unfollowUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(false);
        expect(transactItems()).toHaveLength(1);
    });

    // 解除側の鏡。「マーカーは無いのに一覧に残っている」も押し直しで直す。
    it("マーカーが無いのに一覧に残っている状態は、押し直しで直る", async () => {
        mockDdbSend
            .mockRejectedValueOnce(txCancelled(["ConditionalCheckFailed", "None", "None"]))
            .mockResolvedValueOnce({ Item: { list: [OTHER, THIRD], rev: 1 } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        expect((await invoke(unfollowUser, ev(ME, OTHER))).statusCode).toBe(200);

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string; list?: string[] } } }).input?.Item)
            .find((i) => i?.id?.startsWith("following#"));
        expect(put?.list).toEqual([THIRD]);
        expect(transactItems()).toHaveLength(1);   // カウンタは動かさない
    });

    it("マーカー以外の理由で撃ち直しても駄目なら 500（冪等扱いにしない）", async () => {
        // ここで 200 を返すと「解除済み扱いなのにカウンタが減っていない」
        // 状態が固定される（押し直しても早期 return で直らない）。
        for (let i = 0; i < 3; i++) {
            mockDdbSend.mockRejectedValueOnce(txCancelled(["None", "ThrottlingError", "None"]));
        }
        mockDdbSend.mockResolvedValueOnce({ Item: { followers: 3, following: 0 } });
        expect((await invoke(unfollowUser, ev(ME, OTHER))).statusCode).toBe(500);
    });

    it("一覧の更新を諦めたら失敗を返し、マーカーもカウンタも戻す", async () => {
        mockDdbSend.mockResolvedValueOnce({});                       // 解除のトランザクション
        for (let i = 0; i < 4; i++) {
            mockDdbSend
                .mockResolvedValueOnce({ Item: { list: [OTHER] } })
                .mockRejectedValueOnce(condFail());
        }
        mockDdbSend.mockResolvedValueOnce({});                       // 戻しのトランザクション
        const res = await invoke(unfollowUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(500);

        const tx = transactItems();
        expect(tx).toHaveLength(2);
        expect(tx[1][0].Put?.Item?.id).toBe(`follow#${OTHER}#${ME}`);
        expect(tx[1][1].Update?.Key?.id).toBe(`followstats#${OTHER}`);
    });
});

// 打ち消しが落ちたとき、**マーカーだけを単発で戻してはいけない**。
// 一度そう書いたが、マーカーは「次の1回の増減を許可する券」なので、
// 券だけ戻すとカウンタが二重に動く:
//   解除が成立（-1）→ 一覧が競合し続ける → 打ち消しも競合で落ちる
//   → マーカーだけ戻す → 画面は一覧を見るので「フォロー中」のまま
//   → 押し直す → マーカーがあるので **もう一度 -1**
// 床（`> :z`）は0付近しか守らないので、100 が 98 になるのは止まらない。
describe("打ち消しが失敗したとき", () => {
    /** マーカーを指す単発コマンド（一覧の Put とは混ざらない） */
    function markerSingles() {
        return [...commandsNamed("PutCommand"), ...commandsNamed("DeleteCommand")]
            .map((c) => ((c.input.Item ?? c.input.Key) as { id?: string } | undefined)?.id)
            .filter((id) => id?.startsWith("follow#"));
    }

    it("フォローの打ち消しが落ちても、マーカーを単発で消さない", async () => {
        queueUserExists();
        mockDdbSend.mockResolvedValueOnce({});                       // フォローのトランザクション
        for (let i = 0; i < 4; i++) {
            mockDdbSend
                .mockResolvedValueOnce({ Item: { list: [] } })
                .mockRejectedValueOnce(condFail());                  // 一覧の Put が競合し続ける
        }
        // 打ち消しのトランザクションが3回とも競合で落ちる
        for (let i = 0; i < 3; i++) {
            mockDdbSend.mockRejectedValueOnce(txCancelled(["None", "TransactionConflict", "None"]));
        }
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(500);
        expect(markerSingles()).toEqual([]);
    });

    it("解除の打ち消しが落ちても、マーカーを単発で戻さない", async () => {
        mockDdbSend.mockResolvedValueOnce({});                       // 解除のトランザクション
        for (let i = 0; i < 4; i++) {
            mockDdbSend
                .mockResolvedValueOnce({ Item: { list: [OTHER] } })
                .mockRejectedValueOnce(condFail());
        }
        for (let i = 0; i < 3; i++) {
            mockDdbSend.mockRejectedValueOnce(txCancelled(["None", "TransactionConflict", "None"]));
        }
        expect((await invoke(unfollowUser, ev(ME, OTHER))).statusCode).toBe(500);
        expect(markerSingles()).toEqual([]);
    });

    // 「既にフォロー済み」だった回は**この呼び出しでは何も書いていない**。
    // ここで打ち消すと、前回成立していたフォローを勝手に解除してしまう。
    it("冪等だった回は打ち消さない（他人の成立済みフォローを壊さない）", async () => {
        queueUserExists();
        mockDdbSend.mockRejectedValueOnce(txCancelled(["ConditionalCheckFailed", "None", "None"]));
        for (let i = 0; i < 4; i++) {
            mockDdbSend
                .mockResolvedValueOnce({ Item: { list: [] } })
                .mockRejectedValueOnce(condFail());
        }
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(500);
        // 送られたトランザクションは最初の1本だけ（打ち消しを撃っていない）
        expect(transactItems()).toHaveLength(1);
        expect(markerSingles()).toEqual([]);
    });
});

// 「撃ち直す」だけを見ていて「**待って**」を見ていなかった。
// sleep の行を消しても29本すべて通っていた——競合相手に即座に撃ち返す
// ことになり、まさに競合が減らない。
describe("撃ち直しの間隔", () => {
    it("撃ち直す前に待つ（100ms → 200ms の倍々）", async () => {
        const waits: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
            ((fn: () => void, ms?: number) => {
                waits.push(ms ?? 0);
                return realSetTimeout(fn, 0);   // テストは待たせない
            }) as unknown as typeof globalThis.setTimeout,
        );
        try {
            for (let i = 0; i < 3; i++) {
                mockDdbSend.mockRejectedValueOnce(txCancelled(["None", "TransactionConflict", "None"]));
            }
            mockDdbSend.mockResolvedValueOnce({ Item: { followers: 3, following: 0 } });
            expect((await invoke(unfollowUser, ev(ME, OTHER))).statusCode).toBe(500);
        } finally {
            spy.mockRestore();
        }
        expect(waits).toEqual([100, 200]);
    });
});

describe("getFollowStats / getMyFollowing", () => {
    it("公開の数を返す（未設定・負値は0）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { followers: 5, following: 2 } });
        expect(JSON.parse((await invoke(getFollowStats, ev(undefined, OTHER))).body)).toEqual({ followers: 5, following: 2 });
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        expect(JSON.parse((await invoke(getFollowStats, ev(undefined, "u3"))).body)).toEqual({ followers: 0, following: 0 });
        // 「負値は0」と名乗っておきながら、負値を一度も渡していなかった。
        // 過去の引きすぎで負になったデータが表示に出ないことを確かめる。
        mockDdbSend.mockResolvedValueOnce({ Item: { followers: -3, following: -1 } });
        expect(JSON.parse((await invoke(getFollowStats, ev(undefined, "u4"))).body)).toEqual({ followers: 0, following: 0 });
    });

    it("自分の following userId 一覧を返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["a", "b"] } });
        expect(JSON.parse((await invoke(getMyFollowing, ev(ME, undefined))).body)).toEqual({ userIds: ["a", "b"] });
    });
});

// following# の一覧は以前「読む → 変える → 無条件で Put」だった。
// 短時間に2人フォローすると両方が同じリストを読み、片方の書き込みが
// もう片方を丸ごと上げ書きして一覧からフォローが消える。しかも
// follow# マーカーは残るため、再フォローしても早期 return で直らない。
describe("フォロー一覧の同時更新", () => {
    /** followUser の DDB 呼び出しを順に組み立てる（マーカー→カウンタ×2→一覧） */
    function setupFollow(listResponses: unknown[], putResults: ("ok" | "conflict")[]) {
        let listCall = 0;
        let putCall = 0;
        mockDdbSend.mockImplementation((cmd: { input?: Record<string, unknown> }) => {
            const input = cmd.input ?? {};
            // 相手が実在するかの確認（USERS_TABLE）
            if (input.TableName === "users-test") return Promise.resolve({ Item: { userId: THIRD } });
            const key = input.Key as { id?: string } | undefined;
            // following# の読み取り
            if (key?.id?.startsWith("following#")) {
                return Promise.resolve(listResponses[listCall++] ?? {});
            }
            // following# への書き込み
            const item = input.Item as { id?: string } | undefined;
            if (item?.id?.startsWith("following#")) {
                const outcome = putResults[putCall++] ?? "ok";
                return outcome === "conflict" ? Promise.reject(condFail()) : Promise.resolve({});
            }
            return Promise.resolve({});
        });
    }

    it("書き込みが競合したら読み直して、既存のフォローを残したまま追加する", async () => {
        setupFollow(
            [
                { Item: { list: [], rev: 0 } },        // 1回目: 空に見えた
                { Item: { list: [OTHER], rev: 1 } },     // 競合後の読み直し: 他が b を入れていた
            ],
            ["conflict", "ok"],
        );

        const res = await invoke(followUser, ev(ME, THIRD));
        expect(res.statusCode).toBe(200);

        const puts = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string; list?: string[] } } }).input?.Item)
            .filter((i) => i?.id?.startsWith("following#"));
        // 最後の書き込みには両方入っている（b を消していない）
        expect(puts[puts.length - 1]!.list).toEqual([THIRD, OTHER]);
    });

    it("書き込みにはリビジョンの条件が付く（無条件の上書きをしない）", async () => {
        setupFollow([{ Item: { list: [OTHER], rev: 3 } }], ["ok"]);
        await invoke(followUser, ev(ME, THIRD));

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input!)
            .find((i) => (i.Item as { id?: string } | undefined)?.id?.startsWith("following#"))!;
        expect(put.ConditionExpression).toContain("rev = :rev");
        expect((put.ExpressionAttributeValues as Record<string, unknown>)[":rev"]).toBe(3);
        expect((put.Item as { rev: number }).rev).toBe(4);
    });

    it("一覧の更新を諦めたら失敗を返し、マーカーも取り消す", async () => {
        // 以前はログを1行出して 200 を返していた。マーカーは残るので
        // 「フォロー済み扱いなのに一覧に出ない」状態が固定され、
        // 押し直しても「既にフォロー済み」で早期 return して直らない
        // （その人の写真がフィードに二度と出てこない）。
        setupFollow(
            Array.from({ length: 5 }, () => ({ Item: { list: [], rev: 0 } })),
            ["conflict", "conflict", "conflict", "conflict"],
        );

        const res = await invoke(followUser, ev(ME, THIRD));
        expect(res.statusCode).toBe(500);

        // 押し直せるように follow# マーカーを消している。
        // 打ち消しはカウンタと1つのトランザクションで行うので、
        // マーカーは TransactItems の Delete に入る。
        const undo = transactItems().at(-1);
        expect(undo?.[0].Delete?.Key?.id).toBe(`follow#${THIRD}#${ME}`);
    });

    it("rev を持たない既存データも書き込める（後方互換）", async () => {
        setupFollow([{ Item: { list: [OTHER] } }], ["ok"]);
        await invoke(followUser, ev(ME, THIRD));

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input!)
            .find((i) => (i.Item as { id?: string } | undefined)?.id?.startsWith("following#"))!;
        expect(put.ConditionExpression).toContain("attribute_not_exists(rev)");
    });

    it("既にフォロー済みなら一覧を書き換えない", async () => {
        setupFollow([{ Item: { list: [THIRD], rev: 2 } }], ["ok"]);
        await invoke(followUser, ev(ME, THIRD));

        const puts = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string } } }).input?.Item)
            .filter((i) => i?.id?.startsWith("following#"));
        expect(puts).toHaveLength(0);
    });
});


// PostConfirmation トリガーが失敗した人・トリガー導入前に登録した人は
// USERS_TABLE に行が無い。行だけを見ていた頃は**誰からもフォローできず**、
// しかも公開プロフィールは 200 で開いてボタンも出るので、押して初めて
// 404 になった（相手にも本人にも直す手段が無い）。写真があれば実在とみなす。
describe("フォローの実在判定: users 行が無い人", () => {
    it("写真が1枚でもあればフォローできる", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "GetCommand") return Promise.resolve({});               // users 行なし
            if (name === "QueryCommand") return Promise.resolve({ Count: 1 });   // 写真あり
            return Promise.resolve({});
        });
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        // 写真の有無は GSI に Limit 1 で聞く（全件数えない）
        const q = mockDdbSend.mock.calls.map((c) => c[0])
            .find((cmd) => cmd?.constructor?.name === "QueryCommand");
        expect(q.input.Limit).toBe(1);
        expect(q.input.Select).toBe("COUNT");
    });

    it("写真の確認そのものが落ちたら 503（404 と混ぜない・何も書かない）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({});
            if (cmd.constructor.name === "QueryCommand") return Promise.reject(new Error("throttled"));
            return Promise.resolve({});
        });
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(503);
        expect(transactItems()).toHaveLength(0);
    });

    // 退会の墓石は「実在する」に数えない。数えると、消えた ID を
    // フォローできてしまう（api-user/src/userProfile.ts の
    // isDeletedProfile と対。退会は行を消さずに deletedAt を立てる）。
    it("退会済み（deletedAt がある行）は 404。写真の有無も見に行かない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            const name = cmd.constructor.name;
            if (name === "GetCommand") {
                return Promise.resolve({ Item: { userId: OTHER, deletedAt: "2026-08-27T00:00:00.000Z" } });
            }
            // ここに来たら「墓石を見落として写真を探しに行った」ということ
            if (name === "QueryCommand") return Promise.resolve({ Count: 1 });
            return Promise.resolve({});
        });
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(404);
        expect(transactItems()).toHaveLength(0);
        // 墓石を見た時点で決まる（写真は数えない）
        expect(mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => cmd?.constructor?.name === "QueryCommand")).toHaveLength(0);
    });

    // **射影に deletedAt が無いと、上の判定は本番で常に false になる。**
    // DynamoDB は射影した属性しか返さないため。ところがテストのモックは
    // 射影を無視して Item をそのまま返すので、`ProjectionExpression` を
    // "userId" に戻しても墓石のテストは緑のまま通ってしまう（実測）。
    // 「実装を消しても通るテスト」の再発形なので、式そのものを見る。
    it("実在判定は deletedAt まで射影する（射影から漏れると判定が死ぬ）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: { userId: OTHER } });
            return Promise.resolve({});
        });
        await invoke(followUser, ev(ME, OTHER));

        const get = mockDdbSend.mock.calls.map((c) => c[0])
            .find((cmd) => cmd?.constructor?.name === "GetCommand");
        expect(get.input.ProjectionExpression).toContain("deletedAt");
    });

    it("行も写真も無ければ今までどおり 404（でたらめな UUID でゴミを作らせない）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            const name = cmd.constructor.name;
            if (name === "GetCommand") return Promise.resolve({});
            if (name === "QueryCommand") return Promise.resolve({ Count: 0 });
            return Promise.resolve({});
        });
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(404);
        // 何も書いていない
        expect(transactItems()).toHaveLength(0);
    });
});


// owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
// **フォロワー側は返せない**——いまのデータは `following#<uid>` と
// 数（`followstats#`）だけで、「誰にフォローされているか」を引ける行が無い。
describe("getUserFollowing（その人がフォローしている人）", () => {
    const evUid = (sub: string | undefined, uid: string | undefined) => ({
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: uid ? { uid } : undefined,
    });

    it("名前まで返す（画面が1人ずつ引きに行かなくて済むように）", async () => {
        mockDdbSend.mockImplementation((cmd: { input: { Key?: { id?: string } } }) => {
            const id = cmd.input.Key?.id ?? "";
            if (id === `followstats#${ME}`) return Promise.resolve({ Item: { followers: 0, following: 2 } });
            return Promise.resolve({ Item: { list: [OTHER, THIRD] } });
        });
        mockLookupIfSet.mockImplementation(async (id: string) => (id === OTHER ? "旅人B" : undefined));
        const res = await invoke(getUserFollowing, evUid(ME, ME));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).users).toEqual([{ id: OTHER, name: "旅人B" }, { id: THIRD }]);
        expect(JSON.parse(res.body).total).toBe(2);
        expect(JSON.parse(res.body).listed).toBe(2);
    });

    // **`total` は数（`followstats#`）。** 一覧の長さを返していた頃は、
    // 上限（2000）で溢れた場合や `undoFollow` が落ちた回に、シートの
    // 見出しとピルの数字が食い違った。`following#` が空で数が 0 でないと
    // 「まだ誰もフォローしていません」と出る（followers 側で直した矛盾）
    it("一覧が空でも、数は followstats# の値を返す", async () => {
        mockDdbSend.mockImplementation((cmd: { input: { Key?: { id?: string } } }) => {
            const id = cmd.input.Key?.id ?? "";
            if (id === `followstats#${ME}`) return Promise.resolve({ Item: { followers: 0, following: 3 } });
            return Promise.resolve({});
        });
        const res = await invoke(getUserFollowing, evUid(ME, ME));
        expect(JSON.parse(res.body).total, "一覧の長さを数として返している").toBe(3);
        expect(JSON.parse(res.body).listed).toBe(0);
    });

    // **数が取れなくても一覧は返す**（今より悪くしない）
    it("数の取得が落ちても 200 で一覧を返す", async () => {
        mockDdbSend.mockImplementation((cmd: { input: { Key?: { id?: string } } }) => {
            const id = cmd.input.Key?.id ?? "";
            if (id === `followstats#${ME}`) return Promise.reject(new Error("throttled"));
            return Promise.resolve({ Item: { list: [OTHER] } });
        });
        const res = await invoke(getUserFollowing, evUid(ME, ME));
        expect(res.statusCode, "数が取れないだけで一覧を失っている").toBe(200);
        expect(JSON.parse(res.body).users).toHaveLength(1);
    });

    // **上限を「入れる前」に見る。** 2000回の GetItem は1回の呼び出しの
    // 6秒には収まらない（`Promise.all` の並列でも、DynamoDB の応答と
    // 再送のぶんが積み上がる）
    it("50人までしか名前を引かない（総数は返す）", async () => {
        const many = Array.from({ length: 60 }, (_, i) => `0000000${String(i).padStart(4, "0")}-1111-4111-8111-111111111111`);
        mockDdbSend.mockImplementation((cmd: { input: { Key?: { id?: string } } }) => {
            const id = cmd.input.Key?.id ?? "";
            if (id === `followstats#${ME}`) return Promise.resolve({ Item: { followers: 0, following: 60 } });
            return Promise.resolve({ Item: { list: many } });
        });
        const res = await invoke(getUserFollowing, evUid(ME, ME));
        expect(JSON.parse(res.body).users).toHaveLength(50);
        expect(JSON.parse(res.body).total, "総数が分からない").toBe(60);
        expect(mockLookupIfSet, "全員ぶん引きに行っている").toHaveBeenCalledTimes(50);
    });

    // **退会した人は印で伝える。** 墓石の行に `displayName` は無いので
    // 名前は引けないが、画面はそれを「名前を設定していない人」と区別できず
    // 「旅人」という普通の行として出し、空のプロフィールへリンクしていた。
    // 退会が消すのは自分の `following#` だけなので（`account.ts`）、
    // **他人の一覧には残り続ける**
    it("退会した人には印を付ける（普通の行として出させない）", async () => {
        mockDdbSend.mockResolvedValue({ Item: { list: [OTHER, THIRD] } });
        mockDeleted.mockResolvedValue(new Set([THIRD]));
        mockLookupIfSet.mockResolvedValue("旅人B");
        const res = await invoke(getUserFollowing, evUid(ME, ME));
        expect(JSON.parse(res.body).users).toEqual([{ id: OTHER, name: "旅人B" }, { id: THIRD, deleted: true }]);
    });

    it("一覧が空なら、退会者の照会には行かない", async () => {
        mockDdbSend.mockResolvedValue({ Item: { list: [] } });
        await invoke(getUserFollowing, evUid(ME, ME));
        expect(mockDeleted).not.toHaveBeenCalled();
    });

    // 片側だけの防御を作らない（`getStories` / `getStoryReplies` /
    // `postComment` は全部この判定を通している）
    it("その人にブロックされていたら 404（一覧を読まない）", async () => {
        mockIsBlocked.mockImplementation((blocker: string) => Promise.resolve(blocker === OTHER));
        const res = await invoke(getUserFollowing, evUid(ME, OTHER));
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).error).not.toContain("ブロック");
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("でたらめなIDは断る（何も読まない）", async () => {
        expect((await invoke(getUserFollowing, evUid(ME, "not-a-uuid"))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // **共有キャッシュに載せない**（人の繋がりは本人向けの応答として扱う）
    it("no-store で返す", async () => {
        mockDdbSend.mockResolvedValue({ Item: { list: [] } });
        const res = await invoke(getUserFollowing, evUid(ME, ME)) as unknown as { headers: Record<string, string> };
        expect(res.headers["Cache-Control"]).toContain("no-store");
    });
});


// **「誰にフォローされているか」を引ける行が無かった**（FOLLOWERS-1）。
// マーカー（`follow#<自分>#<相手>`）は主キーが1本で前方一致の列挙ができない
// ——このテーブルにソートキーは無いので、全表 Scan しか手が無かった。
// `following#` と同じ形の行（新しい順のリスト＋`rev`）を持たせる。
describe("フォロワーの一覧（followers#）", () => {
    const evUid = (sub: string | undefined, uid: string | undefined) => ({
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: uid ? { uid } : undefined,
    });
    /** 種類とキーで答える（順番に並べる形だと、書き込みが1つ増えるたびに全部ずれる） */
    function world(rows: Record<string, Record<string, unknown>> = {}) {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string; userId?: string } } }) => {
            const name = cmd.constructor.name;
            if (name === "GetCommand") {
                // users テーブルの主キーは `userId`（写真テーブルは `id`）
                if (cmd.input.Key?.userId) return Promise.resolve({ Item: { userId: cmd.input.Key.userId } });
                return Promise.resolve({ Item: rows[cmd.input.Key?.id ?? ""] });
            }
            return Promise.resolve({});
        });
    }
    const puts = () => mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: { Item?: { id?: string; list?: string[] } } })
        .filter((c) => c.constructor.name === "PutCommand" && c.input.Item?.id?.startsWith("followers#"));

    it("フォローすると、相手のフォロワー一覧に自分が入る", async () => {
        world({ [`followstats#${OTHER}`]: { followers: 1, following: 0 } });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);
        expect(puts(), "相手の一覧に入っていない").toHaveLength(1);
        expect(puts()[0].input.Item).toMatchObject({ id: `followers#${OTHER}`, list: [ME] });
    });

    it("解除すると、相手のフォロワー一覧から外れる", async () => {
        world({
            [`followers#${OTHER}`]: { list: [ME, THIRD], rev: 3 },
            [`following#${ME}`]: { list: [OTHER], rev: 1 },
            [`followstats#${OTHER}`]: { followers: 2, following: 0 },
        });
        expect((await invoke(unfollowUser, ev(ME, OTHER))).statusCode).toBe(200);
        expect(puts()[0].input.Item).toMatchObject({ id: `followers#${OTHER}`, list: [THIRD] });
    });

    // **押し直しで直る。** `following#` と同じ考え——「マーカーはあるが
    // 一覧に無い」を、利用者の操作だけで直せるようにしておく
    it("既にフォロー済みでも、一覧に無ければ入れ直す", async () => {
        world({
            [`follow#${OTHER}#${ME}`]: { follow: true },
            [`followstats#${OTHER}`]: { followers: 1, following: 0 },
        });
        // マーカーが既にある＝トランザクションは条件で落ちる
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: unknown } }) => {
            if (cmd.constructor.name === "TransactWriteCommand") return Promise.reject(txCancelled(["ConditionalCheckFailed", "None", "None"]));
            if (cmd.constructor.name === "GetCommand") {
                const key = cmd.input.Key as { id?: string; userId?: string } | undefined;
                if (key?.userId) return Promise.resolve({ Item: { userId: key.userId } });
                if (key?.id === `followstats#${OTHER}`) return Promise.resolve({ Item: { followers: 1, following: 0 } });
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);
        expect(puts(), "押し直しても直らない").toHaveLength(1);
    });

    // **`try` の外に置く。** 中に入れると `updateFollowing` が投げた回に
    // 丸ごと飛ぶ——ブロックしたのに相手のフォロワー一覧に自分が残る
    it("ブロックで、自分の一覧が書けなくても相手のフォロワー一覧からは外す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string }; Item?: { id?: string } } }) => {
            const name = cmd.constructor.name;
            // `following#<自分>` の書き込みだけ、ずっと競合させる
            if (name === "PutCommand" && cmd.input.Item?.id === `following#${ME}`) {
                return Promise.reject(Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" }));
            }
            if (name === "GetCommand") {
                const id = cmd.input.Key?.id ?? "";
                if (id === `following#${ME}`) return Promise.resolve({ Item: { list: [OTHER], rev: 1 } });
                if (id === `followers#${OTHER}`) return Promise.resolve({ Item: { list: [ME], rev: 1 } });
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
        const { unfollowQuietly } = await import("../follow");
        await unfollowQuietly(OTHER, ME);
        expect(puts().some((p) => p.input.Item?.id === `followers#${OTHER}`),
            "相手のフォロワー一覧に残る").toBe(true);
    });

    // **多人数が同じ行を書くので、やり直しに間を置く**（`following#<自分>` は
    // 書き手が自分1人だが、`followers#<相手>` はその人をフォロー／解除する
    // 全員）。ただし**最後の回は待たない**——待ってもループが尽きて投げる
    // だけで、その 100〜300ms は丸損（`followUser` は2つの行を通るので
    // 最悪 1,125ms、既定6秒の枠から削る意味が無い）
    it("競合し続けても、最後の回は待たずに諦める", async () => {
        const waits: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
            waits.push(ms ?? 0);
            return realSetTimeout(fn, 0);
        }) as typeof setTimeout);
        try {
            mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
                if (cmd.constructor.name === "PutCommand") {
                    return Promise.reject(Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" }));
                }
                if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: { list: [ME], rev: 1 } });
                return Promise.resolve({});
            });
            const { updateFollowersQuietly } = await import("../follow");
            await updateFollowersQuietly(OTHER, ME, false);
            // 4回試して、待つのは3回（最後の1回のあとは待たない）
            expect(waits.length, "最後の回のあとも待っている").toBe(3);
        } finally {
            vi.mocked(globalThis.setTimeout).mockRestore();
        }
    });

    // 正常系。**これが無いと「成功しても触らない」変異が素通りする**
    // （実際に素通りした）
    it("ブロックでの解除が通ったら、相手のフォロワー一覧からも外す", async () => {
        world({
            [`followers#${OTHER}`]: { list: [ME, THIRD], rev: 1 },
            [`following#${ME}`]: { list: [OTHER], rev: 1 },
        });
        const { unfollowQuietly } = await import("../follow");
        await unfollowQuietly(OTHER, ME);
        const followersPut = puts().find((p) => p.input.Item?.id === `followers#${OTHER}`);
        expect(followersPut, "相手の一覧に残る").toBeDefined();
        expect(followersPut!.input.Item?.list).toEqual([THIRD]);
    });

    // **解除そのものが失敗した回は、相手の一覧も触らない。**
    // 一度この呼び出しを `try` の外に出したが、`try` には
    // `unfollowAtomically` も入っているので、解除が成立していないのに
    // 相手の一覧からだけ自分が消えていた——マーカーも数も自分を数えた
    // ままなので、**誰も直せない不整合**（変更前は1行も書かれず整合していた）
    it("解除そのものが落ちたら、相手のフォロワー一覧は触らない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            if (cmd.constructor.name === "TransactWriteCommand") {
                return Promise.reject(txCancelled(["None", "TransactionConflict"]));
            }
            if (cmd.constructor.name === "GetCommand") {
                const id = cmd.input.Key?.id ?? "";
                if (id === `followers#${OTHER}`) return Promise.resolve({ Item: { list: [ME], rev: 1 } });
                if (id === `following#${ME}`) return Promise.resolve({ Item: { list: [OTHER], rev: 1 } });
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
        const { unfollowQuietly } = await import("../follow");
        await unfollowQuietly(OTHER, ME);
        expect(puts(), "解除できていないのに相手の一覧から消している").toHaveLength(0);
    });

    // **表示の都合でフォローを失敗させない。** マーカーと数は既に正しく、
    // 欠けるのは一覧の1行だけ
    it("一覧を書けなくても、フォローそのものは成功する", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Item?: { id?: string } } }) => {
            if (cmd.constructor.name === "PutCommand" && cmd.input.Item?.id?.startsWith("followers#")) {
                return Promise.reject(new Error("throttled"));
            }
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: { userId: OTHER, followers: 1, following: 0 } });
            return Promise.resolve({});
        });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);
    });

    it("その人のフォロワーを名前つきで返す", async () => {
        world({
            [`followers#${ME}`]: { list: [OTHER, THIRD] },
            [`followstats#${ME}`]: { followers: 2, following: 0 },
        });
        mockLookupIfSet.mockImplementation(async (id: string) => (id === OTHER ? "旅人B" : undefined));
        const res = await invoke(getUserFollowers, evUid(ME, ME));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).users).toEqual([{ id: OTHER, name: "旅人B" }, { id: THIRD }]);
        expect(JSON.parse(res.body).total).toBe(2);
        expect(JSON.parse(res.body).listed).toBe(2);
    });

    // **数は `followstats#` が正。** 一覧の長さを `total` にすると、
    // 埋め戻し前は「5 フォロワー」と言いながら開くと「まだフォロワーは
    // いません」になる（一覧が空で `total: 0` なので、足りないことを
    // 伝える行も出ない）。画面はこの2つで「0人」と「まだ揃っていない」を
    // 見分ける
    it("一覧が空でも、数は followstats# の値を返す（0人と混ぜない）", async () => {
        world({ [`followstats#${ME}`]: { followers: 5, following: 0 } });
        const res = await invoke(getUserFollowers, evUid(ME, ME));
        expect(JSON.parse(res.body).users).toEqual([]);
        expect(JSON.parse(res.body).total, "一覧の長さを数として返している").toBe(5);
        expect(JSON.parse(res.body).listed).toBe(0);
    });

    it("退会した人には印を付ける", async () => {
        world({ [`followers#${ME}`]: { list: [THIRD] } });
        mockDeleted.mockResolvedValue(new Set([THIRD]));
        const res = await invoke(getUserFollowers, evUid(ME, ME));
        expect(JSON.parse(res.body).users).toEqual([{ id: THIRD, deleted: true }]);
    });

    it("その人にブロックされていたら 404（一覧を読まない）", async () => {
        mockIsBlocked.mockImplementation((blocker: string) => Promise.resolve(blocker === OTHER));
        const res = await invoke(getUserFollowers, evUid(ME, OTHER));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("でたらめなIDは断る（何も読まない）", async () => {
        expect((await invoke(getUserFollowers, evUid(ME, "not-a-uuid"))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("50人までしか名前を引かない（総数は返す）", async () => {
        const many = Array.from({ length: 60 }, (_, i) => `0000000${String(i).padStart(4, "0")}-1111-4111-8111-111111111111`);
        world({
            [`followers#${ME}`]: { list: many },
            [`followstats#${ME}`]: { followers: 60, following: 0 },
        });
        const res = await invoke(getUserFollowers, evUid(ME, ME));
        expect(JSON.parse(res.body).users).toHaveLength(50);
        expect(JSON.parse(res.body).total).toBe(60);
        expect(JSON.parse(res.body).listed).toBe(60);
    });
});
