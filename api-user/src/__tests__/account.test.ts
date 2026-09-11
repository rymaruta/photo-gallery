import { describe, it, expect, vi, beforeEach } from "vitest";

// DynamoDB / S3 をモック
const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
    DeleteObjectsCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));

const mockRebuild = vi.hoisted(() => vi.fn());
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
vi.stubEnv("USERS_TABLE", "users-test");
const { deleteAccount } = await import("../account");

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (handler: unknown, event: unknown, context?: unknown): Promise<LambdaResult> => (handler as any)(event, context);

function ev(sub: string | undefined) {
    return { requestContext: { authorizer: { jwt: { claims: { sub } } } } };
}

// 送信された DeleteCommand / UpdateCommand の Key.id を集める
function deletedDdbIds(): string[] {
    return mockDdbSend.mock.calls
        .map((c) => c[0])
        .filter((cmd) => cmd?.constructor?.name === "DeleteCommand")
        .map((cmd) => String(cmd.input?.Key?.id ?? cmd.input?.Key?.userId ?? ""));
}
// 写真の派生画像は DeleteObjects でまとめて消す（1枚ごとに直列で消していた頃は
// 写真が数十枚あるだけで Lambda の実行時間を使い切っていた）。
// アバター/カバーは決定的キーなので単発の DeleteObject のまま。
function deletedS3Keys(): string[] {
    const keys: string[] = [];
    for (const call of mockS3Send.mock.calls) {
        const input = call[0]?.input as { Key?: unknown; Delete?: { Objects?: { Key?: unknown }[] } } | undefined;
        if (input?.Key) keys.push(String(input.Key));
        for (const o of input?.Delete?.Objects ?? []) keys.push(String(o.Key));
    }
    return keys;
}

beforeEach(() => {
    mockRebuild.mockReset().mockResolvedValue(true);
    mockDdbSend.mockReset();
    mockS3Send.mockReset().mockResolvedValue({});
});

describe("deleteAccount", () => {
    it("認証なし（sub 欠落）は 401 で何も削除しない", async () => {
        const res = await invoke(deleteAccount, ev(undefined));
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("写真の S3 本体/サムネと item、プロフィール、既知ドキュメントを削除する", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") {
                // GSI: 写真1枚（1ページで終了）
                return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            }
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "p1") {
                    return Promise.resolve({
                        Item: {
                            id: "p1",
                            userId: "me",
                            src: "https://cdn.test/uploads/p1.jpg",
                            thumbSrc: "https://cdn.test/uploads/p1_thumb.jpg",
                        },
                    });
                }
                // golist / following は空
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });

        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });

        // 写真本体とサムネの両方を S3 から削除
        const s3 = deletedS3Keys();
        expect(s3).toContain("uploads/p1.jpg");
        expect(s3).toContain("uploads/p1_thumb.jpg");
        // アバター/カバーも決定的キーで削除
        expect(s3).toContain("profiles/me");
        expect(s3).toContain("profiles/me/cover");

        // 写真 item・既知ドキュメントを削除
        const ids = deletedDdbIds();
        expect(ids).toContain("p1");
        expect(ids).toContain("notifs#me");
        expect(ids).toContain("followstats#me");
        expect(ids).toContain("following#me");

        // プロフィール行は**消すのではなく墓石に置き換える**。
        // ただ消すと、期限まで有効な古いトークンを持った別端末が
        // GET /user/profile を叩いたときに行が作り直され、退会が
        // 取り消されてしまう（消えた ID がフォローできる状態になる）。
        expect(ids).not.toContain("me");
        const tomb = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .filter((c) => c.constructor.name === "PutCommand")
            .map((c) => c.input.Item as Record<string, unknown>)
            .find((it) => it?.userId === "me");
        expect(tomb).toBeDefined();
        expect(typeof tomb!.deletedAt).toBe("string");
        expect(typeof tomb!.ttl).toBe("number");
        // 退会前の中身を持ち越さない
        expect(tomb).not.toHaveProperty("displayName");
    });

    // 写真の削除失敗は Cognito を消す前に止める。200 で通すと、GPS 入りの
    // 原本が公開URLに残ったままアカウントだけ消え、やり直せる人がいなくなる
    // （フォロー掃除の「残っても200」はフォロワー数のズレだけだから成り立つ
    // 判断で、写真には当てはまらない——調査ラウンド3の a-2）。
    describe("写真の削除に失敗が残ったら退会を止める", () => {
        const photoWorld = () => {
            mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
                const name = cmd.constructor.name;
                if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
                if (name === "GetCommand") {
                    const id = String((cmd.input.Key as { id?: string }).id ?? "");
                    if (id === "p1") return Promise.resolve({ Item: { id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" } });
                    return Promise.resolve({ Item: undefined });
                }
                return Promise.resolve({});
            });
        };

        it("S3 のバッチ削除が落ちたら 500（プロフィール削除にも進まない）", async () => {
            photoWorld();
            mockS3Send.mockImplementation((cmd: { constructor: { name: string } }) => {
                if (cmd.constructor.name === "DeleteObjectsCommand") return Promise.reject(new Error("s3 down"));
                return Promise.resolve({});
            });
            const res = await invoke(deleteAccount, ev("me"));
            expect(res.statusCode).toBe(500);
            expect(JSON.parse(res.body).error).toContain("アカウントはまだ削除されていません");
            // 後段（プロフィール行の削除）へ進んでいない
            expect(deletedDdbIds()).not.toContain("me");
        });

        it("S3 の失敗した写真の行は消さない（再実行の手がかりを残す＝冪等）", async () => {
            // 行は S3 キーの唯一の手がかり。失敗したまま消すと、500 →
            // 再実行しても GSI に出てこず、原本が公開URLに孤児で残る
            // （de7b871 レビューが実ハンドラで再現した回帰）。
            photoWorld();
            mockS3Send.mockImplementation((cmd: { constructor: { name: string } }) => {
                if (cmd.constructor.name === "DeleteObjectsCommand") return Promise.reject(new Error("s3 down"));
                return Promise.resolve({});
            });
            await invoke(deleteAccount, ev("me"));
            expect(deletedDdbIds()).not.toContain("p1");
            expect(deletedDdbIds()).not.toContain("comments#p1");
        });

        it("8並列でも失敗カウントが消えない（ロストアップデート）", async () => {
            // `mediaFailures += await ...` は左辺を await の前に読むため、
            // 並列だと他の worker の加算を古い値で上書きしていた。
            // p1 の S3 を遅らせて成功させ、その間に p2 の行削除を失敗させる。
            mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
                const name = cmd.constructor.name;
                if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }, { id: "p2", userId: "me" }] });
                if (name === "GetCommand") {
                    const id = String((cmd.input.Key as { id?: string }).id ?? "");
                    if (id === "p1" || id === "p2") {
                        return Promise.resolve({ Item: { id, userId: "me", src: `https://cdn.test/uploads/${id}.jpg` } });
                    }
                    return Promise.resolve({ Item: undefined });
                }
                if (name === "DeleteCommand" && String((cmd.input.Key as { id?: string }).id ?? "") === "p2") {
                    return Promise.reject(new Error("ddb down"));
                }
                return Promise.resolve({});
            });
            mockS3Send.mockImplementation((cmd: { constructor: { name: string }; input?: { Delete?: { Objects?: { Key?: string }[] } } }) => {
                if (cmd.constructor.name === "DeleteObjectsCommand") {
                    const keys = (cmd.input?.Delete?.Objects ?? []).map((o) => String(o.Key));
                    if (keys.some((k) => k.includes("p1"))) {
                        return new Promise((r) => setTimeout(() => r({}), 50));  // p1 は遅れて成功
                    }
                }
                return Promise.resolve({});
            });
            expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(500);
        });

        it("GSI 縮退（Get 失敗）も失敗に数え、行を消さない", async () => {
            mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
                const name = cmd.constructor.name;
                if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
                if (name === "GetCommand" && String((cmd.input.Key as { id?: string }).id ?? "") === "p1") {
                    return Promise.reject(new Error("ddb get down"));
                }
                if (name === "GetCommand") return Promise.resolve({ Item: undefined });
                return Promise.resolve({});
            });
            expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(500);
            expect(deletedDdbIds()).not.toContain("p1");
        });

        it("comments# の削除失敗も 500 で止め、行は残す（再実行で拾える）", async () => {
            mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
                const name = cmd.constructor.name;
                if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
                if (name === "GetCommand") {
                    const id = String((cmd.input.Key as { id?: string }).id ?? "");
                    if (id === "p1") return Promise.resolve({ Item: { id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" } });
                    return Promise.resolve({ Item: undefined });
                }
                if (name === "DeleteCommand" && String((cmd.input.Key as { id?: string }).id ?? "") === "comments#p1") {
                    return Promise.reject(new Error("ddb down"));
                }
                return Promise.resolve({});
            });
            expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(500);
            expect(deletedDdbIds()).not.toContain("p1");
        });

        it("アバターの削除失敗も 500（決定的キーなので再実行で必ずやり直せる）", async () => {
            photoWorld();
            mockS3Send.mockImplementation((cmd: { constructor: { name: string }; input?: { Key?: string } }) => {
                if (cmd.constructor.name === "DeleteObjectCommand" && cmd.input?.Key === "profiles/me") {
                    return Promise.reject(new Error("s3 down"));
                }
                return Promise.resolve({});
            });
            const res = await invoke(deleteAccount, ev("me"));
            expect(res.statusCode).toBe(500);
            // プロフィール行の削除には進まない
            expect(deletedDdbIds()).not.toContain("me");
        });

        it("S3 が部分失敗（Errors）を返しても 500", async () => {
            photoWorld();
            mockS3Send.mockImplementation((cmd: { constructor: { name: string } }) => {
                if (cmd.constructor.name === "DeleteObjectsCommand") {
                    return Promise.resolve({ Errors: [{ Key: "uploads/p1.jpg", Code: "InternalError" }] });
                }
                return Promise.resolve({});
            });
            const res = await invoke(deleteAccount, ev("me"));
            expect(res.statusCode).toBe(500);
            expect(deletedDdbIds()).not.toContain("me");
        });

        it("写真行の DDB 削除が落ちても 500", async () => {
            mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
                const name = cmd.constructor.name;
                if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
                if (name === "GetCommand") {
                    const id = String((cmd.input.Key as { id?: string }).id ?? "");
                    if (id === "p1") return Promise.resolve({ Item: { id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" } });
                    return Promise.resolve({ Item: undefined });
                }
                if (name === "DeleteCommand" && String((cmd.input.Key as { id?: string }).id ?? "") === "p1") {
                    return Promise.reject(new Error("ddb down"));
                }
                return Promise.resolve({});
            });
            expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(500);
        });
    });

    // 「行きたいリスト」は書き込む経路がどこにも無い（通知の型に残っていた
    // だけで、マーカーを作る口も UI のボタンも存在しない）。
    // 消す側だけ持っていても、カウンタを直せるわけではないので落とした。
    // マーカー削除と相手のカウンタ減算は**1つのトランザクション**にする。
    // 別々の書き込みだった頃は、片方だけ効いた状態が残って
    //   1回目の作り: どちらも無条件 → 再実行で引きすぎ
    //   2回目の作り: 消せたときだけ減らす → タイムアウトで引き足りない
    // のどちらかに必ず倒れた。両方効くか両方効かないかにすれば、
    // 何度実行しても正しい数に収束する。
    const transacts = () => mockDdbSend.mock.calls
        .map((c) => c[0])
        .filter((cmd) => cmd?.constructor?.name === "TransactWriteCommand");

    const followingIs = (list: string[], onTransact?: () => Promise<unknown>) => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                // USERS_TABLE の自分の行。実在する人の退会なので必ずある
                // （静的ページの作り直しを頼むかの判定がこれを見る）
                if ((cmd.input.Key as { userId?: string }).userId === "me") {
                    return Promise.resolve({ Item: { userId: "me" } });
                }
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "following#me") return Promise.resolve({ Item: { list } });
                return Promise.resolve({ Item: undefined });
            }
            if (name === "TransactWriteCommand" && onTransact) return onTransact();
            return Promise.resolve({});
        });
    };

    // フォロー通知の間引きマーカー（follownotify#<target>#<自分>）は
    // 退会の掃除リストに載っておらず、退会のたびに1件ずつ残っていた。
    // スコープ外リストにも書かれていない「誰も消さないゴミ」。
    it("解除が済んだ相手の follownotify# マーカーも消す", async () => {
        followingIs(["userA", "userB"]);
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);

        const deleted = deletedDdbIds();
        expect(deleted).toContain("follownotify#userA#me");
        expect(deleted).toContain("follownotify#userB#me");
    });

    it("解除に失敗した相手の follownotify# は消さない（借りの手がかりを残す）", async () => {
        followingIs(["userA"], () => Promise.reject(new Error("throttled")));
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds()).not.toContain("follownotify#userA#me");
    });

    it("フォロー中の解除は、削除と減算を1つの書き込みで行う", async () => {
        followingIs(["userA", "userB"]);
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);

        const items = transacts().map((cmd) => cmd.input.TransactItems as Record<string, { Key?: { id?: string }; ConditionExpression?: string }>[]);
        expect(items).toHaveLength(2);
        for (const [i, target] of ["userA", "userB"].entries()) {
            expect(items[i][0].Delete?.Key?.id).toBe(`follow#${target}#me`);
            expect(items[i][1].Update?.Key?.id).toBe(`followstats#${target}`);
        }
        // マーカー削除に条件が要る。これが無いと、やり直したときに
        // 「既に消えたマーカーの分までもう一度減らす」に戻る
        // ——unfollowAtomically の40行のコメントが丸ごとこの説明。
        for (const tx of items) {
            expect(tx[0].Delete?.ConditionExpression).toBe("attribute_exists(id)");
            expect(tx[1].Update?.ConditionExpression).toContain("followers > :z");
        }

        // 片方だけを書く経路は残っていない
        const updates = mockDdbSend.mock.calls
            .map((c) => c[0])
            .filter((cmd) => cmd?.constructor?.name === "UpdateCommand")
            .map((cmd) => String(cmd.input?.Key?.id ?? ""));
        expect(updates).not.toContain("followstats#userA");
    });

    // TransactionCanceledException = 条件不成立、ではない。
    // 名前だけを見てマーカーを消していた頃は、人気ユーザーへの同時フォローと
    // ぶつかった（= 未コミットの）キャンセルでもマーカーを消していたので、
    // 相手のフォロワー数が1多いまま誰にも直せなくなった。
    // CancellationReasons を1件ずつ見る必要がある。
    const cancelled = (codes: string[]) => Object.assign(
        new Error("cancelled"),
        { name: "TransactionCanceledException", CancellationReasons: codes.map((Code) => ({ Code })) },
    );

    it("マーカーが既に無い（前回で処理済み）なら、何も消さずに片付いた扱い", async () => {
        followingIs(["userA"], () => Promise.reject(cancelled(["ConditionalCheckFailed", "None"])));
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        // 借りは無いので単体削除もしない
        expect(deletedDdbIds()).not.toContain("follow#userA#me");
        expect(deletedDdbIds()).toContain("following#me");
    });

    it("相手の集計が無い/0 のときだけ、マーカーを単体で消す", async () => {
        followingIs(["userA"], () => Promise.reject(cancelled(["None", "ConditionalCheckFailed"])));
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(deletedDdbIds()).toContain("follow#userA#me");
        expect(deletedDdbIds()).toContain("following#me");
        // 単体削除にも条件を付ける。無条件だと、この分岐に来る前に別経路で
        // 消えていた場合に「消したつもり」で通る（＝取りこぼしに気づけない）
        const del = mockDdbSend.mock.calls
            .map((c) => c[0])
            .find((cmd) => cmd?.constructor?.name === "DeleteCommand"
                && cmd.input?.Key?.id === "follow#userA#me");
        expect(del.input.ConditionExpression).toBe("attribute_exists(id)");
    });

    it("単体削除が条件不成立でも片付いた扱いにする（既に消えている）", async () => {
        // 前回の実行で消えていた場合。ここで false にすると、
        // やり直す当てが無いのに following# を残し続けることになる。
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "following#me") return Promise.resolve({ Item: { list: ["userA"] } });
                return Promise.resolve({ Item: undefined });
            }
            if (name === "TransactWriteCommand") {
                return Promise.reject(cancelled(["None", "ConditionalCheckFailed"]));
            }
            if (name === "DeleteCommand" && String((cmd.input.Key as { id?: string }).id ?? "") === "follow#userA#me") {
                return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(deletedDdbIds()).toContain("following#me");   // 片付いた扱い
    });

    it("単体削除がそれ以外で落ちたら、片付いていない扱いにする", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "following#me") return Promise.resolve({ Item: { list: ["userA"] } });
                return Promise.resolve({ Item: undefined });
            }
            if (name === "TransactWriteCommand") {
                return Promise.reject(cancelled(["None", "ConditionalCheckFailed"]));
            }
            if (name === "DeleteCommand" && String((cmd.input.Key as { id?: string }).id ?? "") === "follow#userA#me") {
                return Promise.reject(Object.assign(new Error("throttled"), { name: "ThrottlingException" }));
            }
            return Promise.resolve({});
        });
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(deletedDdbIds()).not.toContain("following#me");   // やり直す手がかりを残す
    });

    // **相手のフォロワー一覧からも外す。** 外さないと、退会した人が
    // 相手の一覧に残り続ける（誰も消す人がいない）
    it("退会すると、相手のフォロワー一覧からも外れる", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                if ((cmd.input.Key as { userId?: string }).userId === "me") return Promise.resolve({ Item: { userId: "me" } });
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "following#me") return Promise.resolve({ Item: { list: ["userA"] } });
                if (id === "followers#userA") return Promise.resolve({ Item: { list: ["me"], rev: 1 } });
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        const puts = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: { Item?: { id?: string } } })
            .filter((c) => c.constructor.name === "PutCommand");
        expect(puts.some((p) => p.input.Item?.id === "followers#userA"),
            "相手の一覧に退会者が残る").toBe(true);
    });

    it("自分のフォロワー一覧の行も消す", async () => {
        followingIs([]);
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds(), "誰も消さない行が残る").toContain("followers#me");
    });

    // **失敗を `failed` に積む。** 積まないと「片付いた」扱いになって
    // 手がかりの `following#me` まで消える
    it("相手の一覧から外せなかったら、片付いていない扱いにする", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "following#me") return Promise.resolve({ Item: { list: ["userA"] } });
                if (id === "followers#userA") return Promise.resolve({ Item: { list: ["me"], rev: 1 } });
                return Promise.resolve({ Item: undefined });
            }
            if (name === "PutCommand" && String((cmd.input.Item as { id?: string })?.id ?? "") === "followers#userA") {
                return Promise.reject(Object.assign(new Error("throttled"), { name: "ThrottlingException" }));
            }
            return Promise.resolve({});
        });
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(deletedDdbIds(), "やり直す手がかりを消している").not.toContain("following#me");
        // **`follownotify#` の削除は飛ばさない。** 早期 return で飛ばすと、
        // コメントが「誰も消さないゴミ」と書いている印がそのまま残る
        expect(deletedDdbIds(), "間引きの印が残る").toContain("follownotify#userA#me");
    });

    it("競合（未コミット）ではマーカーを消さない——引き算が永久に消えるため", async () => {
        // 相手が人気ユーザーだと、他の人のフォロー操作（followstats# への
        // 素の UpdateItem）とぶつかってキャンセルされる。日常的に起きる。
        followingIs(["userA"], () => Promise.reject(cancelled(["None", "TransactionConflict"])));
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(deletedDdbIds()).not.toContain("follow#userA#me");
        expect(deletedDdbIds()).not.toContain("following#me");  // やり直す手がかりを残す
    });

    it("スロットリングでも同じ（未コミット扱い）", async () => {
        followingIs(["userA"], () => Promise.reject(cancelled(["None", "ThrottlingError"])));
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds()).not.toContain("follow#userA#me");
    });

    it("理由が分からないキャンセルでも何も消さない", async () => {
        followingIs(["userA"], () => Promise.reject(
            Object.assign(new Error("cancelled"), { name: "TransactionCanceledException" })));
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds()).not.toContain("follow#userA#me");
        expect(deletedDdbIds()).not.toContain("following#me");
    });

    // 残り時間を見て打ち切る。打ち切らないとハンドラが返らず、
    // 呼び出し側は Cognito の削除に進まない——写真もプロフィールも
    // 消えたのにログインできるアカウントだけが残る。しかも静的ページの
    // 掃除依頼はこのループの**後ろ**にあるので、それも飛ぶ。
    it("残り時間が足りなければ打ち切り、掃除の依頼には必ず到達する", async () => {
        let calls = 0;
        let timeChecks = 0;
        followingIs(["userA", "userB"], () => {
            calls++;
            return Promise.reject(cancelled(["None", "TransactionConflict"]));
        });
        const res = await invoke(deleteAccount, ev("me"), {
            getRemainingTimeInMillis: () => { timeChecks++; return 1000; },
        });

        expect(res.statusCode).toBe(200);
        expect(calls).toBe(0);                    // 1件も撃たずに打ち切る
        expect(mockRebuild).toHaveBeenCalled();   // 掃除は必ず頼む
        expect(deletedDdbIds()).not.toContain("following#me");
        // 打ち切ったら回り直さない。外側で抜けないと、時間切れと分かって
        // いるのに3回とも回して待ち時間まで挟む（掃除の依頼が更に遠のく）。
        // 1回目の入口(1) + その回の2件(2) で 3 回まで。
        expect(timeChecks).toBeLessThanOrEqual(3);
    });

    it("回っている途中で時間切れになったら、そこから先は撃たない", async () => {
        // 入口では足りていたが、処理中に尽きた場合。ここで撃ち続けると
        // 掃除の依頼まで届かない。残りは following# に残して次に託す。
        let n = 0;
        followingIs(["userA", "userB"]);
        const res = await invoke(deleteAccount, ev("me"), {
            // 1回目（ループの入口）だけ十分、以降は足りない
            getRemainingTimeInMillis: () => (++n === 1 ? 25000 : 1000),
        });

        expect(res.statusCode).toBe(200);
        expect(transacts()).toHaveLength(0);      // 1件も撃たない
        expect(mockRebuild).toHaveBeenCalled();
        expect(deletedDdbIds()).not.toContain("following#me");
    });

    it("残り時間が十分なら今までどおり回る", async () => {
        followingIs(["userA"]);
        expect((await invoke(deleteAccount, ev("me"), { getRemainingTimeInMillis: () => 25000 })).statusCode).toBe(200);
        expect(transacts()).toHaveLength(1);
    });

    it("context が無くても動く（テスト・ローカル実行）", async () => {
        followingIs(["userA"]);
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(transacts()).toHaveLength(1);
    });

    it("競合はその場でやり直す（一度きりで諦めない）", async () => {
        // ここで諦めると、呼べる人がもういないので永久に直らない。
        let n = 0;
        followingIs(["userA"], () => {
            n++;
            return n === 1
                ? Promise.reject(cancelled(["None", "TransactionConflict"]))
                : Promise.resolve({});
        });
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(n).toBe(2);
        expect(deletedDdbIds()).toContain("following#me");   // 片付いた
    });

    // 「消せたか分からない」失敗が残ったら、やり直す手がかりを消さない。
    // following# まで消していた頃は、再実行しても対象リストが空になり、
    // 相手のフォロワー数が1多いまま誰にも直せなかった。
    it("片付け切れなかったら following# を残す（ただし 500 にはしない）", async () => {
        followingIs(["userA"], () => Promise.reject(
            Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" })));
        const res = await invoke(deleteAccount, ev("me"));

        // 500 を返すと、呼び出し側は Cognito の削除に進まない。恒常的に失敗する
        // 種類だと、写真もプロフィールも消えたのにログインできるアカウントだけが
        // 残り、退会が永久に完了しない。静的ページの掃除依頼も飛んでしまう。
        expect(res.statusCode).toBe(200);
        expect(mockRebuild).toHaveBeenCalled();
        expect(deletedDdbIds()).not.toContain("following#me");
    });

    // following# 自体が読めなかったときも同じ。エラーを「空」と混ぜて
    // following# を消していた頃は、50人フォローしていた人の退会で
    // 50個のマーカーが孤児になり、50人の数字が1多いまま固定された。
    it("フォロー一覧が読めなかったら following# を残す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "following#me") return Promise.reject(new Error("throttled"));
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(deletedDdbIds()).not.toContain("following#me");
    });

    // 以前は「すべての S3 削除が失敗しても 200」を耐障害として固定していたが、
    // それは GPS 入り原本の消し残しを成功と報告する形だった（a-2 で変更）。
    // ベストエフォートで続行してよいのは**付帯文書**（notifs# 等）だけ。
    it("付帯文書の削除が失敗しても続行し 200（写真の削除は成功している前提）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "https://cdn.test/uploads/p1.jpg" } });
                return Promise.resolve({ Item: undefined });
            }
            if (name === "DeleteCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "notifs#me") return Promise.reject(new Error("ddb delete failed")); // 付帯文書だけ失敗
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });

        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });
        // 失敗の後の削除も実行される
        expect(deletedDdbIds()).toContain("following#me");
    });

    it("GSI が複数ページでも全ページを辿って削除する", async () => {
        let queried = 0;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") {
                queried++;
                if (queried === 1) return Promise.resolve({ Items: [{ id: "p1" }], LastEvaluatedKey: { userId: "me" } });
                return Promise.resolve({ Items: [{ id: "p2" }] });
            }
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "p1" || id === "p2") return Promise.resolve({ Item: { id } });
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });

        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(queried).toBe(2);
        const ids = deletedDdbIds();
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
    });
});

// 退会は取り消せない。消し残しは個人情報が公開URLに残ることを意味するので、
// 「何を消すか」をテストで固定しておく。
describe("deleteAccount: 消し残しを作らない", () => {
    function setupWithPhoto(item: Record<string, unknown>, profile?: Record<string, unknown>) {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                const key = cmd.input.Key as { id?: string; userId?: string };
                if (key.id === "p1") return Promise.resolve({ Item: item });
                if (key.userId === "me") return Promise.resolve({ Item: profile ?? {} });
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
    }

    it("EXIF付きの原本と派生画像もすべて消す", async () => {
        // srcOriginal は EXIF を落とす前の原本。GPS が入ったままなので
        // 消し残すと退会後も公開URLで取得できてしまう。
        setupWithPhoto({
            id: "p1",
            userId: "me",
            src: "https://cdn.test/uploads/p1.jpg",
            srcOriginal: "https://cdn.test/uploads/p1_orig.jpg",
            srcAvif: "https://cdn.test/uploads/p1.avif",
            src256: "https://cdn.test/uploads/p1_256.webp",
            thumbSrc: "https://cdn.test/uploads/p1_thumb.webp",
            thumbSm: "https://cdn.test/uploads/p1_sm.webp",
            thumbAvif: "https://cdn.test/uploads/p1_thumb.avif",
            thumbSmAvif: "https://cdn.test/uploads/p1_sm.avif",
        });
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        const keys = deletedS3Keys();
        for (const k of [
            "uploads/p1.jpg", "uploads/p1_orig.jpg", "uploads/p1.avif", "uploads/p1_256.webp",
            "uploads/p1_thumb.webp", "uploads/p1_sm.webp", "uploads/p1_thumb.avif", "uploads/p1_sm.avif",
        ]) {
            expect(keys).toContain(k);
        }
    });

    it("ユーザー名の予約も解放する（再登録で同じ名前を取り戻せるように）", async () => {
        setupWithPhoto({ id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" }, { userId: "me", username: "ryuhei" });
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(deletedDdbIds()).toContain("username#ryuhei");
    });

    it("ユーザー名が未設定なら予約の削除は行わない", async () => {
        setupWithPhoto({ id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" }, { userId: "me" });
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds().some((id) => id.startsWith("username#"))).toBe(false);
    });

    // 予約の解放は「自分のものだけ」。ここだけ無条件の DeleteItem だった
    // （対の userProfile.ts の releaseUsername は ownerId 一致が条件で、
    //  すぐ上のコメントがその条件を根拠に挙げていた）。墓石に handle を
    // 残して退会をやり直せるようにした以上、条件が無いと**その handle を
    // 後から取った別人の予約を消してしまう**。
    it("予約の削除は ownerId が自分のときだけ", async () => {
        setupWithPhoto({ id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" }, { userId: "me", username: "ryuhei" });
        await invoke(deleteAccount, ev("me"));

        const del = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .find((c) => c.constructor.name === "DeleteCommand"
                && (c.input.Key as { userId?: string })?.userId === "username#ryuhei");
        expect(del).toBeDefined();
        expect(del!.input.ConditionExpression).toBe("ownerId = :o");
        expect((del!.input.ExpressionAttributeValues as Record<string, unknown>)[":o"]).toBe("me");
    });

    // 解放が落ちても 200 を返していたら、呼び出し側は Cognito のユーザーを
    // 削除してサインアウトする——以後この sub の JWT を取れる人はいないので、
    // **やり直せる主体が消える**。墓石に handle を残しても誰も読みに来ない。
    // ownerId 条件も墓石の handle も、やり直しが起きる前提でだけ意味を持つ。
    it("予約の解放が落ちたら 500。墓石も置かない（やり直せる状態で止める）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand" && (cmd.input?.Key as { userId?: string })?.userId === "me") {
                return Promise.resolve({ Item: { userId: "me", username: "ryuhei" } });
            }
            if (name === "DeleteCommand"
                && (cmd.input?.Key as { userId?: string })?.userId === "username#ryuhei") {
                return Promise.reject(Object.assign(new Error("throttled"),
                    { name: "ProvisionedThroughputExceededException" }));
            }
            return Promise.resolve({});
        });
        const res = await invoke(deleteAccount, ev("me"));

        expect(res.statusCode).toBe(500);
        // 墓石を置かない＝やり直しは生きた行から handle を読み直せる
        expect(mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string } })
            .filter((c) => c.constructor.name === "PutCommand")).toHaveLength(0);
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    // 条件不成立（既に無い / 他人が後から取った）は目的が達成済み。
    // ここを失敗扱いにすると、2回目の退会が永久に完了しなくなる。
    it("予約が既に無ければ（条件不成立）そのまま完了する", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand" && (cmd.input?.Key as { userId?: string })?.userId === "me") {
                return Promise.resolve({ Item: { userId: "me", username: "ryuhei" } });
            }
            if (name === "DeleteCommand"
                && (cmd.input?.Key as { userId?: string })?.userId === "username#ryuhei") {
                return Promise.reject(Object.assign(new Error("cond"),
                    { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        const res = await invoke(deleteAccount, ev("me"));

        expect(res.statusCode).toBe(200);
    });

    // 解放が落ちたまま行を墓石で上書きすると、handle の手がかりが消えて
    // **その名前は誰にも取れないまま永久に残る**（A-5 と同じ型）。
    // 墓石に handle を残しておけば、退会をやり直したときに拾える。
    it("墓石に handle を残す（やり直しで解放できるように）", async () => {
        setupWithPhoto({ id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" }, { userId: "me", username: "ryuhei" });
        await invoke(deleteAccount, ev("me"));

        const tomb = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .filter((c) => c.constructor.name === "PutCommand")
            .map((c) => c.input.Item as Record<string, unknown>)
            .find((it) => it?.userId === "me");
        expect(tomb!.username).toBe("ryuhei");
    });

    // プロフィールが読めないまま墓石で上書きすると、同じく handle が消える。
    // 読めないなら止める（アカウントはまだ生きているので押し直せば続く）。
    it("プロフィールを読めなかったら 500。墓石も置かない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand" && (cmd.input?.Key as { userId?: string })?.userId === "me") {
                return Promise.reject(new Error("throttled"));
            }
            return Promise.resolve({});
        });
        const res = await invoke(deleteAccount, ev("me"));

        expect(res.statusCode).toBe(500);
        expect(mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string } })
            .filter((c) => c.constructor.name === "PutCommand")).toHaveLength(0);
        expect(mockRebuild).not.toHaveBeenCalled();
    });
});

// 退会しても静的ページ（/photo/<id>・/users/<id>）は S3 に残り続ける。
// 本文も撮影地も表示名入りの JSON-LD も焼き込まれているので、
// 「消したのに検索から見える」状態になる。定期ビルドは止めてあるため、
// ここで頼まないと誰かが push するまで直らない。
// 写真だけ消していたので、退会後も「本文・投稿者名・投稿者のsub」が
// 誰でも読めるまま残っていた（一覧APIは公開で、写真の存在確認もしない）。
// 消したい本人からは、もう手の届かない場所に残る。
describe("deleteAccount: コメントの消し残し", () => {
    it("写真と一緒に comments#<写真ID> も消す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            if (cmd.constructor.name === "QueryCommand") {
                return Promise.resolve({ Items: [{ id: "p1" }] });
            }
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve({ Item: { id: "p1", src: "https://cdn/uploads/me/p1.jpg" } });
            }
            return Promise.resolve({});
        });
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds()).toContain("p1");
        expect(deletedDdbIds()).toContain("comments#p1");
    });

    // **ストーリーには返信の文書が付く。** `storyreplies#<id>` は
    // `userId` を持たないので退会の列挙（`userId-createdAt-index`）には
    // 載らない＝**ストーリー本体を消すついででしか消せない**。
    // ここを落とすと、退会したのに返信の本文・送信者名・送信者の sub が
    // 残り続ける（このテーブルに TTL は無い）。
    // **写真とストーリーで分けない**——`story` の判定が1か所ずれただけで
    // 本文が置き去りになる。消す側は空振りしても害が無い
    it("ストーリーと一緒に storyreplies#<ID> も消す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            if (cmd.constructor.name === "QueryCommand") {
                return Promise.resolve({ Items: [{ id: "story-1" }] });
            }
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve({ Item: { id: "story-1", story: true, src: "https://cdn/uploads/me/s1.jpg" } });
            }
            return Promise.resolve({});
        });
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds()).toContain("story-1");
        expect(deletedDdbIds(), "退会しても返信の本文が残る").toContain("storyreplies#story-1");
    });
});

describe("deleteAccount: 静的ページの掃除", () => {
    it("成功したらサイトの再ビルドを頼む", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand"
                && (cmd.input?.Key as { userId?: string })?.userId === "me") {
                return Promise.resolve({ Item: { userId: "me", displayName: "旅人" } });
            }
            return Promise.resolve({});
        });
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        expect(String(mockRebuild.mock.calls[0][0])).toContain("me");
    });

    // 2回目の退会（1回目が Cognito 削除で落ちた等）では、写真もプロフィールも
    // 既に消えていて作り直す中身が無い。無条件に投げていたので Actions の枠を
    // 空振りで使っていた（定期ビルドを止めている今は効く）。
    it("この実行で何も消していなければ頼まない（2回目の退会）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand"
                && (cmd.input?.Key as { userId?: string })?.userId === "me") {
                // 既に墓石が立っている
                return Promise.resolve({ Item: { userId: "me", deletedAt: "2026-08-27T00:00:00.000Z" } });
            }
            return Promise.resolve({});   // 写真は0件
        });
        const res = await invoke(deleteAccount, ev("me"));

        expect(res.statusCode).toBe(200);
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    // **依頼はフォローの掃除より前に出す。** 間のループは最大3周×2000件で
    // 待ち時間も挟むので、実行時間を使い切って落ちうる（このファイル冒頭の
    // コメントがそれを前提に書かれている）。そこで落ちると、やり直しの回は
    // 「何も消していない」ので条件に掛からず**二度と頼まれない**——
    // 0773ee1 で条件を入れたときに作った穴。それ以前は毎回無条件に頼んで
    // いたので拾えていた。順番そのものを固定する。
    it("フォローの掃除を始める前に依頼を出す", async () => {
        const order: string[] = [];
        mockRebuild.mockImplementation(async () => { order.push("rebuild"); return true; });
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                if ((cmd.input?.Key as { userId?: string })?.userId === "me") {
                    return Promise.resolve({ Item: { userId: "me", displayName: "旅人" } });
                }
                const id = String((cmd.input?.Key as { id?: string })?.id ?? "");
                if (id === "following#me") {
                    order.push("following-read");
                    return Promise.resolve({ Item: { list: ["userA"] } });
                }
            }
            if (name === "TransactWriteCommand") order.push("unfollow");
            return Promise.resolve({});
        });
        const res = await invoke(deleteAccount, ev("me"));

        expect(res.statusCode).toBe(200);
        expect(order[0]).toBe("rebuild");
        // 掃除が実際に走っていること（走らない世界で順番を主張しない）
        expect(order).toContain("unfollow");
    });

    // 静的ページの入力（photos.json）は
    // `src && published !== false && story !== true` で絞られるので、
    // 下書きしか無い人・ストーリーしか無い人には作り直す HTML が1枚も無い。
    // 全部数えていたので、その人の退会で毎回8分のビルドが空振りしていた。
    it.each([
        ["下書きだけ", { id: "d1", userId: "me", src: "https://cdn.test/uploads/d1.jpg", published: false }],
        ["ストーリーだけ", { id: "s1", userId: "me", src: "https://cdn.test/uploads/s1.jpg", story: true }],
    ])("%s の人の退会では頼まない（静的ページが無い）", async (_name, item) => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: item.id, userId: "me" }] });
            if (name === "GetCommand") {
                if ((cmd.input?.Key as { userId?: string })?.userId === "me") {
                    // プロフィールは既に墓石（＝profileWasLive では拾わせない）
                    return Promise.resolve({ Item: { userId: "me", deletedAt: "2026-08-27T00:00:00.000Z" } });
                }
                if (String((cmd.input?.Key as { id?: string })?.id ?? "") === item.id) {
                    return Promise.resolve({ Item: item });
                }
            }
            return Promise.resolve({});
        });
        const res = await invoke(deleteAccount, ev("me"));

        expect(res.statusCode).toBe(200);
        expect(deletedDdbIds()).toContain(item.id);   // 消してはいる
        expect(mockRebuild).not.toHaveBeenCalled();   // でも作り直す中身は無い
    });

    it("写真を1枚でも消したなら頼む（プロフィールが既に墓石でも）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                if ((cmd.input?.Key as { userId?: string })?.userId === "me") {
                    return Promise.resolve({ Item: { userId: "me", deletedAt: "2026-08-27T00:00:00.000Z" } });
                }
                const id = String((cmd.input?.Key as { id?: string })?.id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" } });
            }
            return Promise.resolve({});
        });
        const res = await invoke(deleteAccount, ev("me"));

        expect(res.statusCode).toBe(200);
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });
});

// 「500 → 再実行で収束する」というコミットの中核主張を通しで固定する
// （各テストは1回目の挙動しか見ていなかった——2b458ce レビューの指摘）
describe("退会の再実行で収束する", () => {
    it("1回目 S3 失敗 → 500、2回目 復旧 → 200 で写真も comments# も消える", async () => {
        let s3Down = true;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" } });
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });
        mockS3Send.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (s3Down && cmd.constructor.name === "DeleteObjectsCommand") return Promise.reject(new Error("s3 down"));
            return Promise.resolve({});
        });

        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(500);
        expect(deletedDdbIds()).not.toContain("p1");   // 手がかりの行は残る

        s3Down = false;
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
        expect(deletedDdbIds()).toContain("p1");
        expect(deletedDdbIds()).toContain("comments#p1");
    });
});


// **共同アルバム（案C）の掃除。**
// 残すと、退会した人のアルバムが招待リンクから開けたまま残り、人数にも
// 数え続ける（写真は消えているので、中身の無いアルバムだけが生き残る）。
describe("deleteAccount: 共同アルバム", () => {
    /** DynamoDB から削除したキー */
    const deletedIds = () => mockDdbSend.mock.calls
        .filter((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand")
        .map((c) => String(((c[0] as { input: { Key?: { id?: string } } }).input.Key ?? {}).id ?? ""));

    function withAlbums(albumIds: string[] | undefined) {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "albums#me") return Promise.resolve({ Item: albumIds ? { albumIds } : undefined });
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });
    }

    it("自分が作ったアルバムと、参加の印と、一覧を消す", async () => {
        withAlbums(["a1", "a2"]);
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        const ids = deletedIds();
        expect(ids, "アルバムを消していない").toContain("album#a1");
        expect(ids).toContain("album#a2");
        expect(ids, "参加の印を消していない").toContain("albummember#a1#me");
        expect(ids, "一覧を消していない").toContain("albums#me");
    });

    it("アルバムを持っていなくても、退会は成功する", async () => {
        withAlbums(undefined);
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
    });

    // **止めない。** ここで 500 にすると、写真もプロフィールも消えたのに
    // ログインできるアカウントだけが残る（フォローの掃除と同じ理由）
    it("アルバムの掃除に失敗しても、退会は止めない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "albums#me") return Promise.reject(new Error("throttled"));
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });
        expect((await invoke(deleteAccount, ev("me"))).statusCode).toBe(200);
    });
});

// **共同アルバムから取り除く経路が、退会に無かった。**
//
// `removePhotoFromAlbum` の docstring が「呼ばれないと何が困るか」を
// 自分で書いている——**500枚の枠を食う／招待ページの窓を死んだ ID で
// 埋めて「生きている写真があるのに空」に見える**。それでも呼んで
// いたのは `deleteMyPhoto` だけで、退会と管理者削除は素通りだった。
//
// 消えるのは**他人のアルバム**に上げた写真。自分が作ったアルバムは
// 行ごと消えるので関係ない。写真の行が `albumId` の唯一の手がかりなので、
// 行を消したあとは誰も辿り直せない＝**永久にずれる**。
describe("退会: 他人のアルバムから自分の写真を取り除く", () => {
    /** 写真1枚が albumId を持つ世界 */
    const world = (photo: Record<string, unknown>, opts: { removeFails?: boolean } = {}) => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            const id = String((cmd.input.Key as { id?: string })?.id ?? "");
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                if (id === "p1") return Promise.resolve({ Item: photo });
                if (id === "album#A") return Promise.resolve({ Item: { id: "album#A", photoIds: ["p1", "other"] } });
                return Promise.resolve({});
            }
            if (name === "UpdateCommand" && id === "album#A" && opts.removeFails) {
                return Promise.reject(Object.assign(new Error("boom"), { name: "ValidationException" }));
            }
            return Promise.resolve({});
        });
    };
    /** アルバムの行に対する UpdateCommand（＝取り除き） */
    const albumUpdates = () => mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
        .filter((cmd) => cmd?.constructor?.name === "UpdateCommand"
            && String((cmd.input.Key as { id?: string })?.id ?? "") === "album#A");
    /**
     * `album#…` を引きに行った回数。
     *
     * **Update の有無だけでは足りない。** `albumId` が無いまま呼んでも
     * `removePhotoFromAlbum` は「その ID は入っていない」で早期 return する
     * ので、Update は出ない——**引きに行ったかどうか**を見ないと、
     * 門を外す変異が素通りする（実際に素通りした）
     */
    const albumGets = () => mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
        .filter((cmd) => cmd?.constructor?.name === "GetCommand"
            && String((cmd.input.Key as { id?: string })?.id ?? "").startsWith("album#"));

    it("アルバムに入れた写真は、アルバムからも取り除く", async () => {
        world({ id: "p1", userId: "me", src: "https://cdn/uploads/me/p1.jpg", albumId: "A" });
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(albumUpdates(), "死んだ ID がアルバムに残る（枠を食い、招待ページの窓を埋める）")
            .toHaveLength(1);
    });

    // **行が消せた写真だけを控える。**
    // S3 が消えず行が残っている写真をアルバムから外すと、**写真は在るのに
    // アルバムから消える**——退会をやり直しても行は残っているので、
    // 誰も戻せない
    it("行を消せなかった写真は、アルバムから外さない", async () => {
        // S3 の削除が落ちる → 行を消さない（既存の設計）
        mockS3Send.mockRejectedValue(new Error("s3 down"));
        world({ id: "p1", userId: "me", src: "https://cdn/uploads/me/p1.jpg", albumId: "A" });
        await invoke(deleteAccount, ev("me"));
        expect(albumUpdates(), "写真は在るのにアルバムから消している").toHaveLength(0);
    });

    // **行の削除そのものが落ちた場合も外さない。**
    // すぐ上のテストは S3 を落としているので、**外側の門**（S3 が全部
    // 消せたか）で止まっていた——内側の `itemFailures === 0` を外す変異は
    // それでは落ちない（実際に落ちなかった）。行の DeleteCommand だけを
    // 落として、内側の門を通る
    it("行の削除が落ちた写真も、アルバムから外さない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            const id = String((cmd.input.Key as { id?: string })?.id ?? "");
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", userId: "me", src: "https://cdn/uploads/me/p1.jpg", albumId: "A" } });
                if (id === "album#A") return Promise.resolve({ Item: { id: "album#A", photoIds: ["p1", "other"] } });
                return Promise.resolve({});
            }
            // 写真の行だけ消せない（comments# / storyreplies# は消せる）
            if (name === "DeleteCommand" && id === "p1") return Promise.reject(new Error("throttled"));
            return Promise.resolve({});
        });

        await invoke(deleteAccount, ev("me"));
        expect(albumUpdates(), "行が残っているのにアルバムから消している").toHaveLength(0);
    });

    // **アルバムに入れていない写真では触らない**（往復を増やさない）
    it("アルバムに入れていない写真では、アルバムを触らない", async () => {
        world({ id: "p1", userId: "me", src: "https://cdn/uploads/me/p1.jpg" });
        await invoke(deleteAccount, ev("me"));
        expect(albumUpdates(), "関係ないのにアルバムを触っている").toHaveLength(0);
        expect(albumGets(), "関係ないのにアルバムを引きに行っている（退会の実行時間は有限）")
            .toHaveLength(0);
    });

    // **掃除の失敗で退会を止めない。** 写真はもう消えているので、
    // ここで失敗を返すと「消えているのに退会できない」になる
    it("取り除きに失敗しても、退会は成立する", async () => {
        world({ id: "p1", userId: "me", src: "https://cdn/uploads/me/p1.jpg", albumId: "A" }, { removeFails: true });
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode, "掃除の失敗で退会を止めている").toBe(200);
    });
});

// **8並列が同じアルバムの行を取り合う。**
//
// 最初は1枚ずつ `removePhotoFromAlbum` を呼んでいた。掃除は
// 「読んで書き直す＋書き直す前の一覧を条件にする」形なので、同じ
// アルバムの写真は**同じ1行を取り合って先着1本以外が全部条件不成立**に
// なる——実測（Get も Update も往復させたモデル）で **8枚中1枚**しか
// 外れなかった。`deleteMyPhoto` の「1枚ずつ直列」の形を、前提を
// 読まずに8並列の文脈へ持ち込んでいた。
//
// **モックが本番より緩いと、この穴は見えない。** Update を同期で返す
// モックだと Get→Update が直列化して 8/8 成功に見える（最初それで
// 「問題なし」と読み違えた）。**両方に往復を入れる。**
describe("退会: 同じアルバムの写真が複数あっても、全部外れる", () => {
    /** 写真 n 枚が同じアルバムに入っている世界（Get も Update も往復する） */
    function manyInOneAlbum(n: number) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        let stored = [...ids, "other"];
        mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            const id = String((cmd.input.Key as { id?: string })?.id ?? "");
            if (name === "QueryCommand") return { Items: ids.map((p) => ({ id: p, userId: "me" })) };
            await new Promise((r) => setTimeout(r, 2));   // 往復
            if (name === "GetCommand") {
                if (ids.includes(id)) return { Item: { id, userId: "me", src: `https://cdn/uploads/me/${id}.jpg`, albumId: "A" } };
                if (id === "album#A") return { Item: { id: "album#A", photoIds: [...stored] } };
                return {};
            }
            if (name === "UpdateCommand" && id === "album#A") {
                const v = cmd.input.ExpressionAttributeValues as { ":prev": string[]; ":next": string[] };
                if (JSON.stringify(v[":prev"]) !== JSON.stringify(stored)) {
                    throw Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" });
                }
                stored = v[":next"];
                return {};
            }
            return {};
        });
        return { left: () => stored };
    }

    it("8枚とも外れる（先着1本だけにならない）", async () => {
        const w = manyInOneAlbum(8);
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(w.left(), "同じ行を取り合って取りこぼしている").toEqual(["other"]);
    });

    // **アルバム1件につき1回で済ませる。** 1枚ずつ撃つと往復が枚数ぶん
    // 増え、退会の実行時間（29秒）を削る
    it("アルバムへの書き込みは1回だけ", async () => {
        manyInOneAlbum(8);
        await invoke(deleteAccount, ev("me"));
        const albumUpdates = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
            .filter((cmd) => cmd?.constructor?.name === "UpdateCommand"
                && String((cmd.input.Key as { id?: string })?.id ?? "") === "album#A");
        expect(albumUpdates, "1枚ずつ撃っている").toHaveLength(1);
    });
});
