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

vi.stubEnv("USERS_TABLE", "users-test");
const { followUser, unfollowUser, getFollowStats, getMyFollowing } = await import("../follow");

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
        mockDdbSend.mockResolvedValueOnce({}); // USERS_TABLE に行が無い
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // 確認の1回だけ
        expect(mockPush).not.toHaveBeenCalled();
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
