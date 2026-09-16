import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCognitoSend = vi.hoisted(() => vi.fn());
const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
    CognitoIdentityProviderClient: class { send = mockCognitoSend; },
    AdminAddUserToGroupCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
    // **列挙でモックしているので、実装が新しく使い始めた export はここにも足す。**
    // 足さないと `new undefined()` になって、その分岐を通るテストだけが落ちる
    CreateGroupCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class { send = mockDdbSend; },
    PutItemCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));

vi.mock("@aws-sdk/util-dynamodb", () => ({
    marshall: (v: unknown) => v,
}));

vi.stubEnv("USERS_TABLE", "users-test");
vi.stubEnv("PHOTOS_TABLE", "photos-test");
const { postConfirmation } = await import("../cognitoTrigger");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<unknown> => (postConfirmation as any)(event);

const event = (triggerSource = "PostConfirmation_ConfirmSignUp") => ({
    triggerSource,
    region: "ap-northeast-1",
    userPoolId: "pool-1",
    userName: "uuid-1",
    request: { userAttributes: { sub: "sub-1" } },
});

beforeEach(() => {
    mockCognitoSend.mockReset().mockResolvedValue({});
    mockDdbSend.mockReset().mockResolvedValue({});
});

// このトリガーが投げると ConfirmSignUp ごと失敗する。
// ところが Cognito は**その前にユーザーを CONFIRMED にしている**ので、
// 利用者には「確認に失敗しました」と出るのに、コードを入れ直しても
// 「すでに確認済みです」で先へ進めない。ログインはできるがグループも
// プロフィールも無く、アップロード・下書き・編集が全部開けない。
// アプリのどこにも復旧手段が無い。だから何があっても投げない。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inputOf = (m: { mock: { calls: unknown[][] } }) => (m.mock.calls[0][0] as any).input;

describe("postConfirmation", () => {
    it("正常系: グループ追加とプロフィール作成を行う", async () => {
        await invoke(event());
        expect(mockCognitoSend).toHaveBeenCalledTimes(1);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    // **回数しか見ていなかった。** `GroupName` を `"admin"` に書き換えても
    // 6件とも緑だった（実測）＝**全新規登録が admin グループに入る**変更が
    // 緑のままデプロイできる（`app/auth/context.tsx` は
    // `groups.includes("admin")` で管理画面を開ける）。
    it("入れるグループは user（admin ではない）", async () => {
        await invoke(event());
        expect(inputOf(mockCognitoSend)).toEqual({
            UserPoolId: "pool-1",
            Username: "uuid-1",
            GroupName: "user",
        });
    });

    // **`ConditionExpression` を消しても6件とも緑だった**（実測）。
    // 消えると、`PostConfirmation_ConfirmSignUp` がもう一度走った人の
    // プロフィール行が `{userId, createdAt}` で丸ごと上書きされる
    // ——表示名・@ハンドル・ピン留め・BGM が消える。
    // 対の api-user 側（`profileConcurrency.test.ts`）はここまで固定して
    // いるのに、**片側だけ抜けていた**。
    it("既にあるプロフィールは絶対に上書きしない（条件つきで書く）", async () => {
        await invoke(event());
        const input = inputOf(mockDdbSend);
        expect(input.TableName, "別のテーブルに書いている").toBe("users-test");
        expect(input.ConditionExpression).toBe("attribute_not_exists(userId)");
        expect(input.Item.userId, "sub 以外を userId にしている").toBe("sub-1");
        expect(typeof input.Item.createdAt).toBe("string");
        // **表示名は入れない。** 登録時にはメールアドレスしか受け取って
        // いないので、流用すると公開画面にメールの一部が出る
        expect("displayName" in input.Item, "登録時にはメールしか無い").toBe(false);
        expect("email" in input.Item).toBe(false);
    });

    it("グループ追加に失敗しても投げない（登録を完了させる）", async () => {
        mockCognitoSend.mockRejectedValue(Object.assign(new Error("throttled"), { name: "TooManyRequestsException" }));
        await expect(invoke(event())).resolves.toBeTruthy();
        // グループに入れなくてもプロフィールは作る
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("プロフィール作成に失敗しても投げない", async () => {
        mockDdbSend.mockRejectedValue(new Error("boom"));
        await expect(invoke(event())).resolves.toBeTruthy();
    });

    it("両方失敗しても投げない", async () => {
        mockCognitoSend.mockRejectedValue(new Error("a"));
        mockDdbSend.mockRejectedValue(new Error("b"));
        await expect(invoke(event())).resolves.toBeTruthy();
    });

    it("確認以外のトリガー（管理者による確認など）では何もしない", async () => {
        await invoke(event("PostConfirmation_ConfirmForgotPassword"));
        expect(mockCognitoSend).not.toHaveBeenCalled();
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("sub が無ければプロフィールは作らない（グループ追加はする）", async () => {
        const e = event() as unknown as { request: { userAttributes: Record<string, string> } };
        e.request.userAttributes = {};
        await invoke(e);
        expect(mockCognitoSend).toHaveBeenCalledTimes(1);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

/**
 * **グループがプールに無いと、新規登録した人が全員 投稿できない。**
 *
 * `AdminAddUserToGroup` は対象のグループが無いと `ResourceNotFoundException`。
 * ここは失敗を握って先へ進む作りなので、**誰も気づかないまま
 * 「ログインできるのに投稿・編集・下書きだけ永久に開けない」**人が増える
 * （再ログインでも直らない。Cognito 側に無いため）。
 *
 * グループを作るのは `scripts/provision-env.js` だけで、それより前に作られた
 * プールには無い。1人目の登録で作られるようにして塞ぐ。
 */
describe("グループが無いプール", () => {
    const notFound = Object.assign(new Error("no group"), { name: "ResourceNotFoundException" });
    const cmdNames = () => mockCognitoSend.mock.calls.map((c) => (c[0] as object).constructor.name);

    it("無ければ作って、入れ直す", async () => {
        mockCognitoSend
            .mockRejectedValueOnce(notFound)   // 1回目の追加
            .mockResolvedValueOnce({})          // グループ作成
            .mockResolvedValueOnce({});         // 入れ直し
        await invoke(event());
        expect(cmdNames()).toEqual([
            "AdminAddUserToGroupCommand", "CreateGroupCommand", "AdminAddUserToGroupCommand",
        ]);
    });

    it("作るのは user だけ（admin は作らない・入れない）", async () => {
        mockCognitoSend.mockRejectedValueOnce(notFound).mockResolvedValue({});
        await invoke(event());
        for (const c of mockCognitoSend.mock.calls) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((c[0] as any).input.GroupName, "admin を触っている").toBe("user");
        }
    });

    // 同時に登録した人が先に作った＝正常。そのまま入れ直す
    it("作ろうとしたら既にあった場合も、入れ直す", async () => {
        mockCognitoSend
            .mockRejectedValueOnce(notFound)
            .mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "GroupExistsException" }))
            .mockResolvedValueOnce({});
        await invoke(event());
        expect(cmdNames()).toEqual([
            "AdminAddUserToGroupCommand", "CreateGroupCommand", "AdminAddUserToGroupCommand",
        ]);
    });

    // **権限不足では作りにいかない。** 同じ理由で失敗するだけなので無駄に叩かない
    it("グループが無い以外の失敗では、作りにいかない", async () => {
        mockCognitoSend.mockRejectedValue(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));
        await invoke(event());
        expect(cmdNames()).toEqual(["AdminAddUserToGroupCommand"]);
    });

    it("作るのも入れ直すのも失敗して、それでも投げない（登録は完了させる）", async () => {
        mockCognitoSend.mockRejectedValue(notFound);
        await expect(invoke(event())).resolves.toBeTruthy();
        // 失敗しても、プロフィール行は作る
        expect(mockDdbSend).toHaveBeenCalled();
    });
});
