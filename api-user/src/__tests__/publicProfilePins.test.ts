import { describe, it, expect, vi, beforeEach } from "vitest";

// **今は見えない写真の ID を、誰にでも返していた。**
//
// ピン留めを外す `removePinnedPhoto` を呼ぶのは**本人の削除だけ**。
// 管理者削除（`api/src/photosMutate.ts`）と非公開化（`updatePhotoVisibility`）は
// 呼ばないので、消えた写真・隠した写真の ID が `pinnedPhotoIds` に残り、
// 未認証で読める `getPublicProfile` がそれを返していた。
//
// **消さずに、読むときに落とす。** ピンは本人の選択なので、非公開に
// しただけで外すと再公開のたびに留め直しになる。

const mockDdbSend = vi.hoisted(() => vi.fn());
// **`userProfile.ts` は独自の `DynamoDBClient` を持っている**（共有の
// `./dynamodb` ではない）。当て先を間違えると本物の資格情報を探しに行き、
// `CredentialsProviderError` を catch が飲んで 500 になる——テストは
// 「500 が返った」だけ見て緑にもできてしまうので、当て先を合わせる。
// コマンドの実クラスは残す（`constructor.name` で見分けるため）
vi.mock("@aws-sdk/client-dynamodb", async (importActual) => {
    const actual = await importActual<typeof import("@aws-sdk/client-dynamodb")>();
    return { ...actual, DynamoDBClient: class { send = mockDdbSend; } };
});
// **テーブル名は環境変数から採られる**（`userProfile.ts` は `requireEnv`）。
// ここを `vi.mock("../dynamodb")` の PHOTOS_TABLE で決めているつもりでいたら、
// あのファイルは `./dynamodb` を import すらしていなかった——実際の名前は
// vitest.setup.ts の `test-photo-gallery-photos` で、下の「写真テーブルを
// 引いた回数」を数える絞り込みが**1件も当たらない**（何も検証していない）。
vi.stubEnv("USERS_TABLE", "users-test");
vi.stubEnv("PHOTOS_TABLE", "photos-test");
const { getPublicProfile } = await import("../userProfile");

const OWNER = "11111111-1111-4111-8111-111111111111";
type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (userId: string): Promise<Result> => (getPublicProfile as any)({ pathParameters: { userId } });

/** DynamoDB の生の形（`GetItemCommand` は marshall 済みで返る） */
const marshalled = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") out[k] = { S: v };
        else if (typeof v === "boolean") out[k] = { BOOL: v };
        else if (Array.isArray(v)) out[k] = { L: v.map((x) => ({ S: String(x) })) };
        else out[k] = { S: String(v) };
    }
    return out;
};

/**
 * プロフィールと写真の両方に応える。
 *
 * **どちらも `GetItemCommand`** なので、コマンド名では分けられない
 * ——テーブル名で見る（分けずに書いたら、プロフィールの Get まで
 * 写真として引かれて「プロフィールが無い」になった）。
 * `photos` に無い id は「消えた写真」。
 */
function world(pins: string[], photos: Record<string, Record<string, unknown>>) {
    mockDdbSend.mockReset().mockImplementation((cmd: { input: Record<string, unknown> }) => {
        if (cmd.input.TableName === "users-test") {
            return Promise.resolve({
                Item: marshalled({ userId: OWNER, displayName: "旅人", pinnedPhotoIds: pins }),
            });
        }
        const key = cmd.input.Key as { id?: { S?: string } };
        const photo = photos[key?.id?.S ?? ""];
        return Promise.resolve(photo ? { Item: marshalled(photo) } : {});
    });
}

const pinsOf = (res: Result): string[] | undefined =>
    (JSON.parse(res.body) as { pinnedPhotoIds?: string[] }).pinnedPhotoIds;

/** 写真テーブルを引いた回数（プロフィールの Get は数えない） */
const photoGets = (): unknown[] => mockDdbSend.mock.calls
    .map((c) => c[0] as { input?: { TableName?: string } })
    .filter((cmd) => cmd?.input?.TableName === "photos-test");

beforeEach(() => { mockDdbSend.mockReset(); });

describe("公開プロフィールのピン留め", () => {
    const live = { id: "p1", userId: OWNER, src: "https://cdn/p1.jpg" };

    it("公開されている写真はそのまま返す（正常系・順序も保つ）", async () => {
        world(["p1", "p2"], {
            p1: live,
            p2: { id: "p2", userId: OWNER, src: "https://cdn/p2.jpg" },
        });
        expect(pinsOf(await invoke(OWNER))).toEqual(["p1", "p2"]);
        // **ピン1枚につき1回まで。** 公開プロフィールは未認証で叩けるので、
        // 1リクエストあたりの読み取りが増えると、そのまま増幅する
        expect(photoGets(), "ピンの枚数より多く引いている").toHaveLength(2);
    });

    it("非公開に戻した写真の ID は返さない", async () => {
        world(["p1", "p2"], {
            p1: live,
            p2: { id: "p2", userId: OWNER, src: "https://cdn/p2.jpg", published: false },
        });
        expect(pinsOf(await invoke(OWNER)), "隠した写真の ID が漏れている").toEqual(["p1"]);
    });

    it("消えた写真の ID は返さない（管理者削除でピンは外れない）", async () => {
        world(["p1", "gone"], { p1: live });
        expect(pinsOf(await invoke(OWNER))).toEqual(["p1"]);
    });

    it("他人の写真の ID は返さない", async () => {
        world(["p1", "other"], {
            p1: live,
            other: { id: "other", userId: "someone-else", src: "https://cdn/o.jpg" },
        });
        expect(pinsOf(await invoke(OWNER))).toEqual(["p1"]);
    });

    it("ストーリーは返さない", async () => {
        world(["p1", "s1"], {
            p1: live,
            s1: { id: "s1", userId: OWNER, src: "https://cdn/s1.mp4", story: true },
        });
        expect(pinsOf(await invoke(OWNER))).toEqual(["p1"]);
    });

    // `published` を持たない古い行は公開扱い（一覧・いいね・コメントと同じ）
    it("published が無い古い行は返す", async () => {
        world(["old"], { old: { id: "old", userId: OWNER, src: "https://cdn/old.jpg" } });
        expect(pinsOf(await invoke(OWNER))).toEqual(["old"]);
    });

    // `uploadedBy` しか持たない移行前の行も本人のものとして扱う
    it("uploadedBy だけの古い行も本人のものとして返す", async () => {
        world(["old"], { old: { id: "old", uploadedBy: OWNER, src: "https://cdn/old.jpg" } });
        expect(pinsOf(await invoke(OWNER))).toEqual(["old"]);
    });

    it("全部見えなくなったら項目ごと落とす", async () => {
        world(["gone1", "gone2"], {});
        expect(pinsOf(await invoke(OWNER))).toBeUndefined();
    });

    // **引けなかったら出さない側に倒す。** 出す側に倒すと、DynamoDB が
    // 一瞬詰まっただけで隠したはずの ID が漏れる。落ちるのはピン1つの表示。
    it("写真を引けなかったら、その ID は出さない", async () => {
        mockDdbSend.mockReset().mockImplementation((cmd: { input: Record<string, unknown> }) => {
            if (cmd.input.TableName === "users-test") {
                return Promise.resolve({ Item: marshalled({ userId: OWNER, displayName: "旅人", pinnedPhotoIds: ["p1"] }) });
            }
            return Promise.reject(new Error("ddb down"));
        });
        expect(pinsOf(await invoke(OWNER)), "引けなかったのに ID を出している").toBeUndefined();
    });

    it("ピンが無ければ写真を引きに行かない（無駄な読み取りをしない）", async () => {
        world([], {});
        await invoke(OWNER);
        expect(photoGets(), "ピンが無いのに写真を引いている").toHaveLength(0);
    });
});
