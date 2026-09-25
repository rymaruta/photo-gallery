import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 🔴 **アプリのバッジと、画面の未読数を食い違わせない。**
 *
 * 素のカウンタ（DynamoDB の `unread`）をそのままバッジに送っていた。
 * `getNotifications` は同じ値を**保存件数で丸め、ブロックした相手のぶんを
 * 除いて**返すので、2つが食い違った:
 *
 *   - 開かずに50件を超えると、バッジは 53 を出すが開くと50件
 *   - **ブロック直後がいちばん悪い。** アプリ内の未読は 0 に落ちるのに、
 *     次に誰かがいいねした瞬間のプッシュでバッジが
 *     「ブロックした相手のぶんを含む数」に戻る
 *
 * `notifications.ts` が「バッジ2 → 開くと『まだ届いていません』」として
 * 直した症状が、プッシュ経由で復活していた。計算は `visibleUnread` の
 * 1か所に置き、**両方がそこを通る**。
 */

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
const mockHidden = vi.hoisted(() => vi.fn(async () => new Set<string>()));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: async () => false,
    hiddenUserIds: (...a: unknown[]) => mockHidden(...(a as [])),
}));
// APNs と端末は境界にする（送信そのものは `apns.test.ts` / `devices.test.ts`）
const mockSend = vi.hoisted(() => vi.fn(async () => ({ sent: 1, invalid: [] as string[] })));
const mockConfigured = vi.hoisted(() => vi.fn(() => true));
vi.mock("../apns", () => ({
    apnsConfigured: () => mockConfigured(),
    sendPush: (...a: unknown[]) => mockSend(...(a as [])),
}));
const mockTokens = vi.hoisted(() => vi.fn(async () => ["a".repeat(64)]));
const mockForget = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../devices", () => ({
    deviceTokens: (...a: unknown[]) => mockTokens(...(a as [])),
    forgetTokens: (...a: unknown[]) => mockForget(...(a as [])),
}));
vi.stubEnv("USERS_TABLE", "users-test");

const { pushNotification, visibleUnread, NOTIFS_MAX } = await import("../notify");

const ME = "11111111-1111-4111-8111-111111111111";
const BAD = "22222222-2222-4222-8222-222222222222";
const OK = "33333333-3333-4333-8333-333333333333";

/** `unread` と `items` を返す世界（`pushNotification` の UpdateItem の応答） */
function serve(unread: number, items: Array<{ byId: string }>) {
    mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) =>
        Promise.resolve(cmd.constructor.name === "UpdateCommand"
            ? { Attributes: { unread, items } }
            : { Item: { displayName: "名前" } }));
}
const notif = { type: "like" as const, byId: OK, byName: "だれか", photoId: "p1" };
const badgeSent = () => (mockSend.mock.calls.at(-1)?.[1] as { badge?: number } | undefined)?.badge;

beforeEach(() => {
    mockDdbSend.mockReset();
    mockHidden.mockReset().mockResolvedValue(new Set<string>());
    mockSend.mockReset().mockResolvedValue({ sent: 1, invalid: [] });
    mockConfigured.mockReset().mockReturnValue(true);
    mockTokens.mockReset().mockResolvedValue(["a".repeat(64)]);
    mockForget.mockReset().mockResolvedValue(undefined);
});

describe("visibleUnread（丸めとブロックの除外）", () => {
    const rows = (n: number, byId = OK) => Array.from({ length: n }, () => ({ byId }));

    it("保存件数を超えない", () => {
        expect(visibleUnread(53, rows(NOTIFS_MAX), new Set()), "バッジだけ 53 を出す").toBe(NOTIFS_MAX);
    });

    it("素の数が件数より少なければ、そのまま", () => {
        expect(visibleUnread(3, rows(10), new Set())).toBe(3);
    });

    // **未読は「先頭 stored 件」＝位置の意味を持つ数。**
    // 全体の長さで丸めるだけでは足りない
    it("ブロックした相手のぶんを、未読の先頭側だけ見て外す", () => {
        const items = [{ byId: BAD }, { byId: BAD }, { byId: BAD }, { byId: OK }, { byId: OK }];
        expect(visibleUnread(3, items, new Set([BAD])), "既読ぶんを数えている").toBe(0);
        expect(visibleUnread(5, items, new Set([BAD]))).toBe(2);
    });

    it("ブロックが無ければ絞らない", () => {
        expect(visibleUnread(2, rows(5), new Set())).toBe(2);
    });

    it("壊れた入力でも 0 以上", () => {
        expect(visibleUnread(undefined, undefined, new Set())).toBe(0);
        expect(visibleUnread(-5, rows(3), new Set())).toBe(0);
        expect(visibleUnread("3", rows(3), new Set())).toBe(0);
    });
});

describe("プッシュのバッジ", () => {
    it("保存件数で丸めた数を送る（素のカウンタを送らない）", async () => {
        serve(53, Array.from({ length: NOTIFS_MAX }, () => ({ byId: OK })));
        await pushNotification(ME, notif);
        expect(badgeSent(), "素のカウンタをそのまま送っている").toBe(NOTIFS_MAX);
    });

    // 🔴 ブロックを押した直後にバッジが戻る、という形を止める
    it("ブロックした相手のぶんをバッジに含めない", async () => {
        mockHidden.mockResolvedValue(new Set([BAD]));
        serve(3, [{ byId: BAD }, { byId: BAD }, { byId: OK }]);
        await pushNotification(ME, notif);
        expect(badgeSent(), "ブロックした相手のぶんが残っている").toBe(1);
    });

    // **ブロック一覧は「送る」と決まってからしか引かない**
    it("設定が無ければ、ブロック一覧も端末も引かない", async () => {
        mockConfigured.mockReturnValue(false);
        serve(1, [{ byId: OK }]);
        await pushNotification(ME, notif);
        expect(mockSend).not.toHaveBeenCalled();
        expect(mockTokens, "設定が無いのに端末を引いている").not.toHaveBeenCalled();
        expect(mockHidden, "設定が無いのにブロック一覧を引いている").not.toHaveBeenCalled();
    });

    it("端末が1つも無ければ、ブロック一覧を引かない", async () => {
        mockTokens.mockResolvedValue([]);
        serve(1, [{ byId: OK }]);
        await pushNotification(ME, notif);
        expect(mockSend).not.toHaveBeenCalled();
        expect(mockHidden, "端末が無いのにブロック一覧を引いている").not.toHaveBeenCalled();
    });

    // **読めなければ丸めだけ効かせる**（倒しすぎると通知が誰にも出ない）
    it("ブロック一覧が読めなくても送る", async () => {
        mockHidden.mockRejectedValue(new Error("throttled"));
        serve(2, [{ byId: OK }, { byId: OK }]);
        await pushNotification(ME, notif);
        expect(badgeSent()).toBe(2);
    });

    it("無効だった宛先だけ外す", async () => {
        mockTokens.mockResolvedValue(["a".repeat(64), "b".repeat(64)]);
        mockSend.mockResolvedValue({ sent: 1, invalid: ["b".repeat(64)] });
        serve(1, [{ byId: OK }]);
        await pushNotification(ME, notif);
        expect(mockForget).toHaveBeenCalledWith(ME, ["b".repeat(64)]);
    });

    it("外すものが無ければ、外しに行かない", async () => {
        serve(1, [{ byId: OK }]);
        await pushNotification(ME, notif);
        expect(mockForget).not.toHaveBeenCalled();
    });

    // 文面はサーバーで作らない（相手の言語を知らない）
    it("種類ごとの鍵を送り、文面は作らない", async () => {
        serve(1, [{ byId: OK }]);
        for (const [type, key] of [["like", "NOTIF_LIKE"], ["comment", "NOTIF_COMMENT"],
            ["follow", "NOTIF_FOLLOW"], ["storyreply", "NOTIF_STORY_REPLY"]] as const) {
            mockSend.mockClear();
            await pushNotification(ME, { ...notif, type });
            const msg = mockSend.mock.calls.at(-1)?.[1] as { locKey?: string; locArgs?: string[] };
            expect(msg.locKey, type).toBe(key);
            expect(msg.locArgs).toEqual(["だれか"]);
        }
    });

    // 送信が落ちても通知は積まれたまま（アプリを開けば読める）
    it("送信が転んでも、通知の追記は成功のまま", async () => {
        mockSend.mockRejectedValue(new Error("boom"));
        serve(1, [{ byId: OK }]);
        await expect(pushNotification(ME, notif)).resolves.toBeUndefined();
    });
});
