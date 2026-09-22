import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../dynamodb", () => ({
    ddb: { send: vi.fn() },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));

const { isVisiblePhoto } = await import("../restrictedFeed");
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
