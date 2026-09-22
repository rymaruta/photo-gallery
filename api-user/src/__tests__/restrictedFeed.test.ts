import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../dynamodb", () => ({
    ddb: { send: vi.fn() },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));

const { isVisiblePhoto, getRestrictedFeed, stripPrivate } = await import("../restrictedFeed");
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

/// **応答そのものを見る。** `stripPrivate` を単体で確かめるだけだと、
/// 「関数は在るのに `body` に通していない」という配線の抜けを誰も見ない
/// （このリポジトリが何度も踏んでいる形）。
describe("GET /feed/restricted の応答", () => {
    // **短い id を使わない。** `isUserId` は 8 文字以上しか通さないので、
    // `"owner"` のような名前だとフォロー一覧が空になり、**中身を見る前に
    // 0 件になって「出していない」に見える**（実際にそれで一度誤った）
    const OWNER = "owner-0001";
    const VIEWER = "viewer-0001";

    const ROW = {
        id: "uploads/a.jpg",
        userId: OWNER,
        audience: "followers",
        src: "https://journey-photo.com/uploads/a.jpg",
        title: "白鳥と湖",
        // ここから下は**外に出してはいけない**もの
        srcOriginal: "https://journey-photo.com/uploads/originals/a.jpg",
        key: `uploads/${OWNER}/a.jpg`,
        staticStale: true,
        publicFeed: "restricted",
        keptFrom: "story#1",
    };

    /** 写真の Query にはこの行を、`following#me` には owner を返す */
    function wireDdb(): void {
        (ddb.send as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: { input: Record<string, unknown> }) => {
            const input = cmd.input;
            if (input.KeyConditionExpression) return { Items: [{ ...ROW }] };
            const key = input.Key as { id?: string } | undefined;
            if (key?.id === `following#${VIEWER}`) return { Item: { list: [OWNER] } };
            return {};
        });
    }

    const EVENT = { requestContext: { authorizer: { jwt: { claims: { sub: VIEWER } } } } };

    async function callFeed(): Promise<Record<string, unknown>[]> {
        wireDdb();
        const res = await getRestrictedFeed(EVENT as never, {} as never, (() => {}) as never);
        const http = res as { statusCode: number; body: string };
        expect(http.statusCode, "そもそも 200 を返していない").toBe(200);
        return JSON.parse(http.body) as Record<string, unknown>[];
    }

    it("見える写真は返す（この判定が空回りしていないこと）", async () => {
        const body = await callFeed();
        expect(body).toHaveLength(1);
        expect(body[0].src).toBe(ROW.src);
        expect(body[0].title).toBe("白鳥と湖");
    });

    /// **原本（GPS 入り）の URL は、相手がフォロワーでも渡さない**
    it.each([
        ["srcOriginal", "EXIF を落とす前の原本（GPS 入り）の URL"],
        ["key", "S3 のオブジェクトキー"],
        ["staticStale", "静的ページの掃除が届いていないという内部の印"],
        ["publicFeed", "公開一覧の GSI に載せるための内部の印"],
        ["keptFrom", "ストーリーから残した写真に付く、元のストーリーのID"],
    ])("応答に %s を出さない（%s）", async (field) => {
        const body = await callFeed();
        expect(body[0], `${field} が応答に残っている`).not.toHaveProperty(field);
        expect(asText(body), `${field} が応答の本文に残っている`).not.toContain(field);
    });

    /// **元の行は触らない**（写しを返す）。触ると、同じ行を見る他の判定が狂う
    it("落とすのは写しで、元の行は変えない", async () => {
        const item = { ...ROW };
        expect(stripPrivate(item).srcOriginal).toBeUndefined();
        expect(item.srcOriginal, "元の行から消えている").toBe(ROW.srcOriginal);
    });
});

function asText(body: Record<string, unknown>[]): string {
    return JSON.stringify(body);
}
