import { describe, it, expect, vi } from "vitest";

vi.mock("../dynamodb", () => ({
    ddb: { send: vi.fn() },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));
vi.mock("../s3Delete", () => ({ s3DeleteMany: vi.fn() }));
vi.mock("../cdnInvalidate", () => ({ invalidateUploads: vi.fn() }));

const { sanitizeAudience, isVisibleToViewer } = await import("../stories");

describe("sanitizeAudience", () => {
    it("受け取るのは followers だけ", () => {
        expect(sanitizeAudience("followers")).toBe("followers");
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

describe("isVisibleToViewer", () => {
    const followers = new Set(["owner"]);

    it("公開範囲の無い行は誰にでも見える（既にある行と同じ形）", () => {
        expect(isVisibleToViewer({ userId: "owner" }, "someone", new Set())).toBe(true);
    });

    it("フォロワーのみは、フォローしている人に見える", () => {
        expect(isVisibleToViewer({ userId: "owner", audience: "followers" }, "me", followers)).toBe(true);
    });

    it("フォロワーのみは、フォローしていない人には見えない", () => {
        expect(isVisibleToViewer({ userId: "owner", audience: "followers" }, "me", new Set())).toBe(false);
    });

    it("本人には必ず見える", () => {
        expect(isVisibleToViewer({ userId: "me", audience: "followers" }, "me", new Set())).toBe(true);
    });

    /// **閉じる側に倒す。** 投稿者が分からない行は見せない
    it("投稿者の分からないフォロワー限定の行は見せない", () => {
        expect(isVisibleToViewer({ audience: "followers" }, "me", new Set())).toBe(false);
        expect(isVisibleToViewer({ userId: "", audience: "followers" }, "me", new Set())).toBe(false);
    });
});

describe("親しい友達", () => {
    const followers = new Set(["owner"]);
    const close = new Set(["owner"]);

    it("受け取るのは followers と closeFriends だけ", () => {
        expect(sanitizeAudience("closeFriends")).toBe("closeFriends");
        expect(sanitizeAudience("close-friends")).toBeUndefined();
        expect(sanitizeAudience("closefriends")).toBeUndefined();
    });

    it("選ばれていれば見える", () => {
        expect(isVisibleToViewer({ userId: "owner", audience: "closeFriends" }, "me",
                                 new Set(), close)).toBe(true);
    });

    /// **フォローでは代用できない。** フォローしていても選ばれていなければ
    /// 見せない（狭い方が勝つ）
    it("フォローしていても、選ばれていなければ見えない", () => {
        expect(isVisibleToViewer({ userId: "owner", audience: "closeFriends" }, "me",
                                 followers, new Set())).toBe(false);
    });

    it("本人には必ず見える", () => {
        expect(isVisibleToViewer({ userId: "me", audience: "closeFriends" }, "me",
                                 new Set(), new Set())).toBe(true);
    });
});
