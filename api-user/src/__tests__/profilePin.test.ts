import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// ピン留めは配列まるごとを PUT していた。rev（楽観ロック）が守れるのは
// 「この処理中に他の書き込みが割り込んだ」場合だけで、実際に起きるのは
// **PC のタブを開きっぱなしにしたまま、スマホでピン留めする**——
// 数時間後に PC 側で別の写真をピン留めすると、PC が開いた時点の配列
// （スマホの1枚を含まない）で丸ごと置き換わり、スマホの分が消える。
// サーバーは新しい rev を普通に書けるので競合として検出されない。
//
// 増減（{ pinPhotoId, pin }）で受け取り、**その瞬間に読んだ配列**の上で
// 足し引きする。follow.ts の updateFollowing と同じ考え方。

const mockSend = vi.hoisted(() => vi.fn());
const commands = vi.hoisted(() => [] as { type: string; input: Record<string, unknown> }[]);

// 写真テーブルへの Get だけ別扱いにする。
//
// ピン留めは「その写真が今も在って自分のものか」を確かめるようになったので、
// 写真テーブルへの Get が1本増える。mockResolvedValueOnce の並びで書いている
// 既存のテストは、この1本に**ユーザーテーブルぶんの応答を食われて**全部ずれる。
// テーブル名で振り分けて、並びは今までどおりユーザーテーブルだけのものにする。
const photoRows = vi.hoisted(() => new Map<string, Record<string, unknown> | null>());
/** 写真テーブルの Get を落とす（fail-open の向きを確かめる用） */
const throwOnPhotoGet = vi.hoisted(() => ({ current: false }));
vi.mock("@aws-sdk/client-dynamodb", () => {
    const make = (type: string) => class {
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) { this.input = input; commands.push({ type, input }); }
    };
    return {
        DynamoDBClient: class {
            send = (cmd: { input?: Record<string, unknown> }) => {
                if (cmd?.input?.TableName === process.env.PHOTOS_TABLE) {
                    if (throwOnPhotoGet.current) return Promise.reject(new Error("ddb down"));
                    const key = (cmd.input.Key as { id?: { S?: string } } | undefined)?.id?.S ?? "";
                    // 既定は「在って自分のもの」。無い写真は setDeletedPhotos で指定する
                    const row = photoRows.has(key) ? photoRows.get(key) : { userId: "u1" };
                    return Promise.resolve(row ? { Item: marshallFn(row) } : {});
                }
                return mockSend(cmd);
            };
        },
        GetItemCommand: make("Get"),
        PutItemCommand: make("Put"),
        DeleteItemCommand: make("Delete"),
    };
});
// vi.mock のファクトリは巻き上げられるので、marshall を直接は掴めない
const marshallFn = (o: Record<string, unknown>) => marshall(o, { removeUndefinedValues: true });
/** 指定したIDを「もう無い写真」にする */
const setDeletedPhotos = (...ids: string[]) => { for (const id of ids) photoRows.set(id, null); };

const { updateMyProfile, removePinnedPhoto } = await import("../userProfile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (body: unknown): Promise<Result> => (updateMyProfile as any)({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: JSON.stringify(body),
});

const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
const stored = (over: Record<string, unknown>) =>
    ({ Item: marshall({ userId: "u1", displayName: "旅人", ...over }, { removeUndefinedValues: true }) });

/** 実際に書き込まれたプロフィール（username# の予約は除く） */
function savedProfile(): Record<string, unknown> {
    const puts = commands
        .filter((c) => c.type === "Put" && !String((c.input.Item as Record<string, { S?: string }>)?.userId?.S ?? "").startsWith("username#"));
    if (puts.length === 0) throw new Error("プロフィールが書かれていない");
    return unmarshall(puts[puts.length - 1].input.Item as Parameters<typeof unmarshall>[0]);
}

beforeEach(() => {
    commands.length = 0;
    photoRows.clear();
    mockSend.mockReset();
});

describe("ピン留めは増減で受け取る", () => {
    it("保存済みの1枚を残したまま足す（開きっぱなしのタブが消さない）", async () => {
        // スマホが先に p9 をピン留めしている
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 4 }))   // getProfile
            .mockResolvedValueOnce({});                                          // Put
        // PC のタブは p9 を知らない（開いた時点では空だった）
        const res = await invoke({ pinPhotoId: "p1", pin: true });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p9", "p1"]);
    });

    it("解除も保存済みの配列から引く（他の1枚は残る）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9", "p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        const res = await invoke({ pinPhotoId: "p1", pin: false });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p9"]);
    });

    it("最後の1枚を解除したら項目ごと消える", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        await invoke({ pinPhotoId: "p1", pin: false });

        expect(savedProfile()).not.toHaveProperty("pinnedPhotoIds");
    });

    it("同じ写真を二度ピン留めしても増えない（冪等）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        const res = await invoke({ pinPhotoId: "p1", pin: true });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p1"]);
    });

    it("保存済みが既に3枚なら 409。黙って落として 200 にしない", async () => {
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "b", "c"], rev: 4 }));
        const res = await invoke({ pinPhotoId: "d", pin: true });

        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error).toContain("3枚");
        // 書き込みに行っていない
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    // 断るだけだと、手元がサーバーとずれているタブは直せない。
    // 「星が1つも無いのに3枚までと言われる」まま何度でも同じことになる。
    it("上限で断るときは、今の一覧を添えて返す", async () => {
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "b", "c"], rev: 4 }));
        const res = await invoke({ pinPhotoId: "d", pin: true });

        expect(JSON.parse(res.body).pinnedPhotoIds).toEqual(["a", "b", "c"]);
    });

    it("競合して読み直したら、**読み直した方**の配列に重ねる", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: [], rev: 4 }))          // 1回目の getProfile
            .mockRejectedValueOnce(condFail())                                      // Put が競合
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 5 }))      // 読み直し
            .mockResolvedValueOnce({});                                             // Put
        const res = await invoke({ pinPhotoId: "p1", pin: true });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p9", "p1"]);
    });

    // 消した写真をあとから留められると、上限は配列の長さだけで数えるので
    // **枠を1つ永久に食い潰す**。画面は見つからないピンを黙って落とすため、
    // 「3枚留めた → 1枚消した → もう1枚留めようとすると 409。でも画面には
    // 2枚しか出ていない」で詰む（解除ボタンは表示された写真の中にしか無い）。
    // 削除の側は removePinnedPhoto で塞いであるが、逆向き——開きっぱなしの
    // 古いタブが、消えた写真をあとから留める——が空いていた。
    it("もう無い写真は留められない（古いタブが枠を食い潰さない）", async () => {
        setDeletedPhotos("gone");
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: [], rev: 4 }));
        const res = await invoke({ pinPhotoId: "gone", pin: true });

        expect(res.statusCode).toBe(404);
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    it("他人の写真も留められない", async () => {
        photoRows.set("theirs", { userId: "u2" });
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: [], rev: 4 }));
        expect((await invoke({ pinPhotoId: "theirs", pin: true })).statusCode).toBe(404);
    });

    // uploadedBy しか無い古い行（userId を入れる前の写真）も自分のもの
    it("古い行（uploadedBy だけ）も自分のものとして留められる", async () => {
        photoRows.set("old", { uploadedBy: "u1" });
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: [], rev: 4 }))
            .mockResolvedValueOnce({});
        expect((await invoke({ pinPhotoId: "old", pin: true })).statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["old"]);
    });

    // **外す側は確かめない。** 消えた写真を外せなくすると、詰みが直せない。
    it("もう無い写真でも外せる", async () => {
        setDeletedPhotos("gone");
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["gone", "p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        expect((await invoke({ pinPhotoId: "gone", pin: false })).statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p1"]);
    });

    // この確認を入れる前に消した写真のぶんは、既に枠に残っている。
    // 断る前に掃除しないと、その人はもう二度と3枚目を留められない。
    it("上限に当たったら、死んだピンを掃除してから留める", async () => {
        setDeletedPhotos("b");
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "b", "c"], rev: 4 }))
            .mockResolvedValueOnce({});
        const res = await invoke({ pinPhotoId: "d", pin: true });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["a", "c", "d"]);
    });

    // 添えるのは**掃除後**の一覧。掃除前を返すと、手元は死んだピンを
    // 抱えたままになり、「星は3つ出ていないのに3枚までと言われる」が続く。
    // 死んだピンが1枚も無い形で書くと、掃除前後が同じで区別が付かない。
    it("掃除しても埋まっていれば、掃除後の一覧を添えて 409", async () => {
        // 4枚留まっている（この確認を入れる前の配列経路で増えた形）。
        // うち1枚が死んでいるので、掃除しても3枚残って上限のまま
        setDeletedPhotos("b");
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "b", "c", "e"], rev: 4 }));
        const res = await invoke({ pinPhotoId: "d", pin: true });

        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).pinnedPhotoIds).toEqual(["a", "c", "e"]);   // b は落ちている
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    // DynamoDB が一時的に読めないときに「あなたの写真は見つかりません」と
    // 言うと、障害の間**全員のピン留めが死ぬ**。在る側に倒す。
    it("写真を引けなければ、在る扱いで通す", async () => {
        photoRows.set("p1", undefined as unknown as Record<string, unknown>);   // 下で例外にする
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: [], rev: 4 }))
            .mockResolvedValueOnce({});
        throwOnPhotoGet.current = true;
        try {
            const res = await invoke({ pinPhotoId: "p1", pin: true });
            expect(res.statusCode).toBe(200);
            expect(savedProfile().pinnedPhotoIds).toEqual(["p1"]);
        } finally {
            throwOnPhotoGet.current = false;
        }
    });

    // 予約行だけ残ると、その @名は**誰も取れないまま永久に残る**
    // （このリポジトリで実際に起きた型）。409 と !saved では戻しているのに、
    // 新しく足した 404 の経路だけ抜ける、が起きやすい。
    it("写真が無くて 404 にするときも、取った @名の予約は返す", async () => {
        setDeletedPhotos("gone");
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: [], rev: 4 }))   // getProfile
            .mockResolvedValueOnce({});                                       // reserveUsername
        const res = await invoke({ username: "newname", pinPhotoId: "gone", pin: true });

        expect(res.statusCode).toBe(404);
        const released = commands.filter((c) => c.type === "Delete");
        expect(released).toHaveLength(1);
        expect((released[0].input.Key as { userId?: { S?: string } }).userId?.S).toBe("username#newname");
    });

    // 古い @名の解放は、全失敗を握りつぶしていた。スロットリング1回で
    // `username#old` の行が残り、**そのあと誰も直せない**——プロフィール行の
    // username は既に新しい方なので、次の保存でも退会の掃除でも対象に入らない。
    // 対になる account.ts の releaseOwnUsername は最初からこの形。
    it("古い @名の解放が一時的に落ちたら、やり直す", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ username: "old", rev: 4 }))   // getProfile
            .mockResolvedValueOnce({})                                    // reserveUsername(new)
            .mockResolvedValueOnce({})                                    // プロフィールの Put
            .mockRejectedValueOnce(new Error("throttled"))                // 解放1回目
            .mockResolvedValueOnce({});                                   // 解放2回目
        const res = await invoke({ username: "newname" });

        expect(res.statusCode).toBe(200);
        const deletes = commands.filter((c) => c.type === "Delete"
            && (c.input.Key as { userId?: { S?: string } }).userId?.S === "username#old");
        expect(deletes).toHaveLength(2);   // 諦めずにもう一度
    });

    // ここに ThrottlingException が届いた時点で SDK は既定の再試行を
    // 使い切っている（likes.ts に同じ話がある）。0ms で連打すると
    // 混雑を悪化させる方にだけ効く。follow.ts / account.ts と同じく待つ
    it("やり直す前に待つ（撃ち直しで混雑を悪化させない）", async () => {
        vi.useFakeTimers();
        try {
            mockSend
                .mockResolvedValueOnce(stored({ username: "old", rev: 4 }))
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new Error("throttled"))
                .mockResolvedValueOnce({});
            const p = invoke({ username: "newname" });
            // 待っている間は2回目を撃たない
            await vi.advanceTimersByTimeAsync(0);
            const before = mockSend.mock.calls.length;
            await vi.advanceTimersByTimeAsync(200);
            expect(mockSend.mock.calls.length).toBeGreaterThan(before);
            await vi.runAllTimersAsync();
            expect((await p).statusCode).toBe(200);
        } finally {
            vi.useRealTimers();
        }
    });

    // 「他人のものだった / 既に無い」は解放するものが無いだけ。やり直さない
    it("条件で弾かれたら、それ以上やり直さない", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ username: "old", rev: 4 }))
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(condFail());
        expect((await invoke({ username: "newname" })).statusCode).toBe(200);
        const deletes = commands.filter((c) => c.type === "Delete"
            && (c.input.Key as { userId?: { S?: string } }).userId?.S === "username#old");
        expect(deletes).toHaveLength(1);
    });

    it("pin が真偽値でなければ 400（既定で外す方に倒さない）", async () => {
        const res = await invoke({ pinPhotoId: "p1" });
        expect(res.statusCode).toBe(400);
        expect(mockSend).not.toHaveBeenCalled();
    });
});

describe("配列形式は残す（古いタブが読み込んだままの JS のため）", () => {
    it("pinnedPhotoIds の配列はこれまでどおり置き換える", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 4 }))
            .mockResolvedValueOnce({});
        const res = await invoke({ pinnedPhotoIds: ["p1"] });

        expect(res.statusCode).toBe(200);
        expect(savedProfile().pinnedPhotoIds).toEqual(["p1"]);
    });

    it("両方来たら増減を採る（配列は古いタブの持ち物）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p9"], rev: 4 }))
            .mockResolvedValueOnce({});
        await invoke({ pinnedPhotoIds: ["p1"], pinPhotoId: "p2", pin: true });

        expect(savedProfile().pinnedPhotoIds).toEqual(["p9", "p2"]);
    });
});


// 写真を消してもピンの枠は空かなかった。applyPinOp は上限(3)を配列長だけで
// 数え、写真の実在を見ない。一方で画面は見つからないピンを黙って落とすので、
// 「3枚留めた → 1枚消した → もう1枚留めようとすると 409。でも画面には2枚しか
// 出ていない」で詰む（解除ボタンは表示された写真にしか無く、増減方式なので
// 消えたピンを外す手段が無い）。写真削除のときに外す。
describe("removePinnedPhoto", () => {
    it("該当のピンだけ外す（他は残す）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["a", "p1", "b"], rev: 4 }))
            .mockResolvedValueOnce({});
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(savedProfile().pinnedPhotoIds).toEqual(["a", "b"]);
    });

    it("最後の1枚なら項目ごと消す", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockResolvedValueOnce({});
        await removePinnedPhoto("u1", "p1");
        expect(savedProfile()).not.toHaveProperty("pinnedPhotoIds");
    });

    it("留めていない写真なら書き込まない", async () => {
        mockSend.mockResolvedValueOnce(stored({ pinnedPhotoIds: ["other"], rev: 4 }));
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    it("プロフィール行が無い・墓石なら何もしない", async () => {
        mockSend.mockResolvedValueOnce({});
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        mockSend.mockResolvedValueOnce(stored({ deletedAt: "2026-08-27T00:00:00.000Z", pinnedPhotoIds: ["p1"] }));
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    it("競合したら読み直して重ね直す（rev 方式）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["p1"], rev: 4 }))
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce(stored({ pinnedPhotoIds: ["z", "p1"], rev: 5 }))
            .mockResolvedValueOnce({});
        expect(await removePinnedPhoto("u1", "p1")).toBe(true);
        expect(savedProfile().pinnedPhotoIds).toEqual(["z"]);
    });

    // 落ちたことを黙って飲むと、呼び出し側が「外せた」と思って行を消し、
    // 宙に浮いたピンが残る
    it("失敗したら false（呼び出し側が止められるように）", async () => {
        mockSend.mockRejectedValue(new Error("boom"));
        expect(await removePinnedPhoto("u1", "p1")).toBe(false);
    });
});

// `truncate` に寄せたとき `body.x?.trim() ?? ""` の形にした。
// `|| undefined` が付いているので挙動は変わっていないが、**それを守る
// テストが1本も無かった**——3つとも `|| undefined` を外しても646件緑だった。
//
// この契約は重い: `undefined` は「その項目を触らない」、`""` は
// **空文字として保存される**（＝表示名が消える）。次に誰かが `?? ""` を
// 整理したときに止まるようにする。
describe("部分更新の契約: 送らなかった項目は触らない", () => {
    /** 書き込まれたプロフィールから、その項目がどうなったかを見る */
    const savedFor = async (body: Record<string, unknown>) => {
        mockSend.mockReset();
        mockSend
            .mockResolvedValueOnce(stored({ displayName: "旅人", bio: "こんにちは", statusText: "旅の途中" }))
            .mockResolvedValueOnce({});
        const res = await invoke(body);
        expect(res.statusCode).toBe(200);
        return savedProfile();
    };

    it.each(["displayName", "bio", "statusText"])(
        "%s を送らなければ、保存済みの値が残る", async (key) => {
            const saved = await savedFor({ displayName: undefined, [key]: undefined });
            expect(saved[key]).toBeTruthy();
        });

    it("空文字を送ったら消える（消す手段は残す）", async () => {
        const saved = await savedFor({ displayName: "" });
        expect(saved.displayName).toBeUndefined();
    });

    it("値を送ったら置き換わる", async () => {
        const saved = await savedFor({ displayName: "新しい名前" });
        expect(saved.displayName).toBe("新しい名前");
    });
});
