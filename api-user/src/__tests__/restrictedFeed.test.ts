import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../dynamodb", () => ({
    ddb: { send: vi.fn() },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));

const { isVisiblePhoto, getRestrictedFeed } = await import("../restrictedFeed");
const { ddb } = await import("../dynamodb");
const { sanitizeAudience } = await import("../sanitize");
const { PUBLIC_FEED_KEY, RESTRICTED_FEED_KEY } = await import("../publicFeed");

describe("絞った写真の見せ方", () => {
    const following = new Set(["owner"]);
    const close = new Set(["owner"]);

    it("フォロワーのみは、フォローしている人に見える", () => {
        expect(isVisiblePhoto({ userId: "owner", audience: "followers" }, "me", following, new Set()))
            .toBe(true);
    });

    it("フォロワーのみは、フォローしていない人には見えない", () => {
        expect(isVisiblePhoto({ userId: "owner", audience: "followers" }, "me", new Set(), new Set()))
            .toBe(false);
    });

    /// **フォローでは代用できない**（狭い方が勝つ）
    it("親しい友達は、フォローしていても選ばれていなければ見えない", () => {
        expect(isVisiblePhoto({ userId: "owner", audience: "closeFriends" }, "me", following, new Set()))
            .toBe(false);
        expect(isVisiblePhoto({ userId: "owner", audience: "closeFriends" }, "me", new Set(), close))
            .toBe(true);
    });

    it("本人には必ず見える", () => {
        expect(isVisiblePhoto({ userId: "me", audience: "closeFriends" }, "me", new Set(), new Set()))
            .toBe(true);
    });

    /// **印の無いものはここに来ない**（仕切りが違う）。来たら出さない
    it("印の無い行は出さない", () => {
        expect(isVisiblePhoto({ userId: "owner" }, "me", following, close)).toBe(false);
        expect(isVisiblePhoto({ audience: "followers" }, "me", following, close)).toBe(false);
    });
});

describe("仕切りと静的サイト", () => {
    /// **同じ索引の別の仕切り**。同じ値にすると `GET /photos` に混ざる
    it("公開と絞りの仕切りは別の値", () => {
        expect(RESTRICTED_FEED_KEY).not.toBe(PUBLIC_FEED_KEY);
    });

    /// **静的サイトに出さない。** 載せた時点で「フォロワーだけ」は守れない
    it("同期スクリプトが audience を持つ行を落とす", () => {
        const src = readFileSync("scripts/sync-photos-from-ddb.js", "utf8");
        expect(src).toMatch(/&&\s*!item\.audience/);
    });

    /// **行の名前を写さない。** 写すと、片方だけ直したときに
    /// 「フォローしている人が一人も出ない」という静かな壊れ方をする
    it("フォロー一覧の行の名前は followCheck.ts から借りる", () => {
        const feed = readFileSync("api-user/src/restrictedFeed.ts", "utf8");
        expect(feed, "自前で組み立てていない").not.toMatch(/`following#\$\{/);
        expect(feed).toMatch(/import \{ followingId \} from "\.\/followCheck"/);
    });
});

/// もとは `storyAudience.test.ts` に在った。ストーリーの公開範囲は
/// owner の判断で無くなった（`storyVisibility.ts`）が、**関数は写真が
/// 使い続ける**ので、検査もこちらへ移す。
describe("sanitizeAudience", () => {
    it("受け取るのは followers と closeFriends だけ", () => {
        expect(sanitizeAudience("followers")).toBe("followers");
        expect(sanitizeAudience("closeFriends")).toBe("closeFriends");
    });

    /// **知らない値を「全体に公開」へ倒さない。**
    /// 倒すと、綴りを間違えた「フォロワーのみ」が全員に見える
    it("知らない値は undefined（属性を書かない＝全体に公開）", () => {
        expect(sanitizeAudience("public")).toBeUndefined();
        expect(sanitizeAudience("Followers")).toBeUndefined();
        expect(sanitizeAudience(undefined)).toBeUndefined();
        expect(sanitizeAudience(1)).toBeUndefined();
        expect(sanitizeAudience({ audience: "followers" })).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────
// 🔴 **外したあと、本当に見えなくなるか**（2026-09-22 の指摘）
//
// ここまでのテストは `isVisiblePhoto` を**単体で**呼ぶものだった。
// 「フォローを外したら見えなくなる」は、その関数ではなく
// **口が毎回サーバーから読み直しているか**で決まる。控えを持っていたり、
// 起動時に一度だけ読んでいたら、外しても見え続ける。
//
// だから**ハンドラを実際に呼び**、保存されている一覧だけを書き換えて
// **同じ要求をもう一度**投げる。
describe("外したあと、次の要求から見えなくなる", () => {
    // 保存されている状態。テストの途中で書き換える
    let following: string[] = [];
    let closeFriendsOfOwner: string[] = [];
    let myBlocks: string[] = [];
    let blockedMe: string[] = [];
    let photos: Record<string, unknown>[] = [];

    const ME = "11111111-1111-1111-1111-111111111111";
    const OWNER = "22222222-2222-2222-2222-222222222222";

    const event = { requestContext: { authorizer: { jwt: { claims: { sub: ME } } } } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (): Promise<{ statusCode: number; body: string }> => (getRestrictedFeed as any)(event);
    const idsFrom = async () => (JSON.parse((await call()).body) as { id: string }[]).map((p) => p.id);

    beforeEach(() => {
        following = [OWNER];
        closeFriendsOfOwner = [ME];
        myBlocks = [];
        blockedMe = [];
        photos = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ddb.send as any).mockReset().mockImplementation((cmd: any) => {
            const input = cmd.input as Record<string, unknown>;
            if (input.KeyConditionExpression) return Promise.resolve({ Items: photos });
            const id = (input.Key as { id: string }).id;
            if (id === `following#${ME}`) return Promise.resolve({ Item: { list: following } });
            if (id === `closefriends#${OWNER}`) return Promise.resolve({ Item: { list: closeFriendsOfOwner } });
            if (id === `blocks#${ME}`) return Promise.resolve({ Item: { blockedIds: myBlocks } });
            if (id === `blockedby#${ME}`) return Promise.resolve({ Item: { blockerIds: blockedMe } });
            return Promise.resolve({});
        });
    });

    it("フォローを外すと、「フォロワーのみ」が次から見えない", async () => {
        photos = [{ id: "r1", src: "https://cdn/r1.jpg", userId: OWNER, audience: "followers" }];
        expect(await idsFrom()).toEqual(["r1"]);
        following = [];                       // ← 外した
        expect(await idsFrom()).toEqual([]);
    });

    it("「親しい友達」から外すと、次から見えない", async () => {
        photos = [{ id: "r2", src: "https://cdn/r2.jpg", userId: OWNER, audience: "closeFriends" }];
        expect(await idsFrom()).toEqual(["r2"]);
        closeFriendsOfOwner = [];             // ← 外した
        expect(await idsFrom()).toEqual([]);
    });

    // **フォローは残したまま**親しい友達だけ外す。フォローで代用されない
    it("親しい友達から外しても、フォローでは代用されない", async () => {
        photos = [{ id: "r3", src: "https://cdn/r3.jpg", userId: OWNER, audience: "closeFriends" }];
        closeFriendsOfOwner = [];
        expect(following).toEqual([OWNER]);
        expect(await idsFrom()).toEqual([]);
    });

    it("こちらがブロックすると、次から見えない", async () => {
        photos = [{ id: "r4", src: "https://cdn/r4.jpg", userId: OWNER, audience: "followers" }];
        expect(await idsFrom()).toEqual(["r4"]);
        myBlocks = [OWNER];                   // ← ブロックした
        expect(await idsFrom()).toEqual([]);
    });

    it("相手にブロックされると、次から見えない", async () => {
        photos = [{ id: "r5", src: "https://cdn/r5.jpg", userId: OWNER, audience: "followers" }];
        expect(await idsFrom()).toEqual(["r5"]);
        blockedMe = [OWNER];                  // ← 相手が私をブロックした
        expect(await idsFrom()).toEqual([]);
    });

    // **自分のぶんは、誰を外しても残る**（外しすぎの見張り）
    it("自分の写真は、フォローもブロックも関係なく残る", async () => {
        photos = [{ id: "mine", src: "https://cdn/mine.jpg", userId: ME, audience: "closeFriends" }];
        following = [];
        closeFriendsOfOwner = [];
        expect(await idsFrom()).toEqual(["mine"]);
    });

    // **控えを持っていないこと。** 持っていたら上のどれかが緑のまま通る
    it("要求のたびに、保存されている一覧を読み直す", async () => {
        photos = [{ id: "r6", src: "https://cdn/r6.jpg", userId: OWNER, audience: "followers" }];
        await call();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const before = (ddb.send as any).mock.calls.length;
        await call();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((ddb.send as any).mock.calls.length).toBeGreaterThan(before);
    });
});

// **配線の抜けを見る。** 署名の関数を単体で試すだけだと
// 「関数は在るのに `body` に通していない」を誰も見ない
// （#134 が `stripPrivate` でまったく同じ穴を指摘している）
describe("一覧の本文に、署名が乗っているか", () => {
    const ME = "11111111-1111-1111-1111-111111111111";
    const event = { requestContext: { authorizer: { jwt: { claims: { sub: ME } } } } };

    it("鍵があれば、返す画像 URL に期限が付く", async () => {
        const { generateKeyPairSync } = await import("node:crypto");
        const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs1", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" },
        });
        vi.stubEnv("CLOUDFRONT_KEY_PAIR_ID", "K2EXAMPLE");
        vi.stubEnv("CLOUDFRONT_PRIVATE_KEY", privateKey as unknown as string);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ddb.send as any).mockReset().mockImplementation((cmd: any) => {
            if ((cmd.input as Record<string, unknown>).KeyConditionExpression) {
                return Promise.resolve({ Items: [{
                    id: "r1", src: "https://cdn/r1.jpg", thumbSrc: "https://cdn/r1-t.jpg",
                    userId: ME, audience: "followers",
                }] });
            }
            return Promise.resolve({});
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (getRestrictedFeed as any)(event);
        const body = JSON.parse(res.body) as { src: string; thumbSrc: string }[];
        expect(body[0].src, "src に署名が乗っていない").toContain("Signature=");
        expect(body[0].thumbSrc, "派生に署名が乗っていない").toContain("Signature=");
        vi.unstubAllEnvs();
    });

    // **鍵が無いいまの本番では、今までどおり**（機能を壊さない）
    it("鍵が無ければ、素の URL のまま返す", async () => {
        vi.unstubAllEnvs();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ddb.send as any).mockReset().mockImplementation((cmd: any) => {
            if ((cmd.input as Record<string, unknown>).KeyConditionExpression) {
                return Promise.resolve({ Items: [{
                    id: "r1", src: "https://cdn/r1.jpg", userId: ME, audience: "followers",
                }] });
            }
            return Promise.resolve({});
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (getRestrictedFeed as any)(event);
        expect((JSON.parse(res.body) as { src: string }[])[0].src).toBe("https://cdn/r1.jpg");
    });
});

