import { describe, it, expect, vi } from "vitest";

// DynamoDB は使わない純関数だけを検証する
vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class { send() { return Promise.resolve({}); } },
    GetItemCommand: class {},
    PutItemCommand: class {},
    DeleteItemCommand: class {},
}));

import { normalizeUsername, USERNAME_RE, RESERVED_USERNAMES, getPublicProfile, toPublicProfile } from "../userProfile";
import type { UserProfile } from "../userProfile";

describe("normalizeUsername", () => {
    it("小文字化し、先頭の @ を落とす", () => {
        expect(normalizeUsername("@Ryuhei_Photo").username).toBe("ryuhei_photo");
        expect(normalizeUsername("  ryuhei  ").username).toBe("ryuhei");
    });

    it("空・null はクリア扱い（エラーにしない）", () => {
        expect(normalizeUsername("")).toEqual({});
        expect(normalizeUsername(null)).toEqual({});
        expect(normalizeUsername("   ")).toEqual({});
    });

    it("記号・空白・大文字以外の文字は弾く", () => {
        expect(normalizeUsername("ryu hei").error).toBeTruthy();
        expect(normalizeUsername("ryu-hei").error).toBeTruthy();
        expect(normalizeUsername("日本語").error).toBeTruthy();
        expect(normalizeUsername("a@b").error).toBeTruthy();
    });

    it("長さ制限（3〜20文字）", () => {
        expect(normalizeUsername("ab").error).toBeTruthy();
        expect(normalizeUsername("abc").username).toBe("abc");
        expect(normalizeUsername("a".repeat(20)).username).toBe("a".repeat(20));
        expect(normalizeUsername("a".repeat(21)).error).toBeTruthy();
    });

    it("予約語は使えない（ルート衝突・なりすまし・紛らわしい語）", () => {
        for (const w of ["photo", "tag", "camera", "login", "official", "staff", "support", "null", "guest"]) {
            expect(normalizeUsername(w).error).toBeTruthy();
        }
    });

    it("admin は誰も使えない（予約語）", () => {
        expect(normalizeUsername("admin").error).toBeTruthy();
        expect(normalizeUsername("@Admin").error).toBeTruthy();
    });

    it("通常のユーザー名は通る", () => {
        expect(normalizeUsername("ryuhei").username).toBe("ryuhei");
        expect(normalizeUsername("@Ryuhei_01").username).toBe("ryuhei_01");
    });

    it("文字列以外はエラー", () => {
        expect(normalizeUsername(123).error).toBeTruthy();
        expect(normalizeUsername({}).error).toBeTruthy();
    });
});

describe("USERNAME_RE / RESERVED_USERNAMES", () => {
    it("規則は英小文字・数字・_ の3〜20文字", () => {
        expect(USERNAME_RE.test("ryuhei_01")).toBe(true);
        expect(USERNAME_RE.test("Ryuhei")).toBe(false);
        expect(USERNAME_RE.test("ab")).toBe(false);
    });
    it("主要ルート名が予約されている", () => {
        for (const w of ["users", "photo", "tag", "location", "category", "camera", "lens", "upload", "drafts"]) {
            expect(RESERVED_USERNAMES.has(w)).toBe(true);
        }
    });

    it("なりすまし系も予約されている", () => {
        for (const w of ["official", "staff", "support", "administrator", "journeyphoto"]) {
            expect(RESERVED_USERNAMES.has(w)).toBe(true);
        }
    });

    it("admin も予約されている", () => {
        expect(RESERVED_USERNAMES.has("admin")).toBe(true);
    });
});

// @ハンドル → Cognito の内部ID が引けないことの回帰ガード。
// 予約アイテム（username#<handle>）は ownerId を持つため、
// 公開エンドポイントから引けると内部IDの一覧化に使える。
describe("getPublicProfile: 予約アイテムを引かせない", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invokePublic = (event: unknown) => (getPublicProfile as any)(event) as Promise<{ statusCode: number }>;

    it("username# を含む userId は 404", async () => {
        const res = await invokePublic({ pathParameters: { userId: "username#alice" } });
        expect(res.statusCode).toBe(404);
    });

    it("通常の userId は引ける", async () => {
        const res = await invokePublic({ pathParameters: { userId: "some-user-id" } });
        expect(res.statusCode).toBe(200);
    });
});

// 公開プロフィールから項目を落とすと、その項目は「消える」。
// UserProfileClient はこの戻り値を編集元として PUT に丸ごと送り返し、
// PUT は全置換なので、返さなかった項目は DynamoDB から削除される。
// 一度 tripTitles/tripCovers/tripSongs/statusText を落として、
// ピン留めするだけで旅アルバムとひとことが消える事故を起こしている。
describe("toPublicProfile: 画面に出る項目を落とさない", () => {
    const full = {
        userId: "u1",
        username: "ryuhei",
        displayName: "旅人",
        bio: "こんにちは",
        instagram: "ig",
        website: "https://example.com",
        themeColor: "#123456",
        songUrl: "https://youtu.be/x",
        songStart: 10,
        songEnd: 40,
        songTitle: "曲",
        songArtist: "人",
        songArtwork: "https://cdn/a.jpg",
        songPreviewUrl: "https://cdn/p.m4a",
        songTrackUrl: "https://music/x",
        songs: [],
        pinnedPhotoIds: ["p1"],
        updatedAt: "2026-08-19T00:00:00.000Z",
        tripTitles: { "trip-1": "北海道" },
        tripCovers: { "trip-1": "p1" },
        tripSongs: { "trip-1": { title: "曲", previewUrl: "https://cdn/p.m4a" } },
        statusText: "旅に出ています",
    } as unknown as UserProfile;

    it.each([
        "tripTitles", "tripCovers", "tripSongs", "statusText",
        "pinnedPhotoIds", "songs", "themeColor", "displayName", "username", "bio",
    ])("%s を返す（保存時の往復で消えないこと）", (field) => {
        const pub = toPublicProfile(full) as Record<string, unknown>;
        expect(pub[field]).toEqual((full as unknown as Record<string, unknown>)[field]);
    });

    it("許可していない項目は返さない", () => {
        const withSecret = { ...full, internalNote: "みせない", email: "a@example.com" } as unknown as UserProfile;
        const pub = toPublicProfile(withSecret) as Record<string, unknown>;
        expect(pub).not.toHaveProperty("internalNote");
        expect(pub).not.toHaveProperty("email");
    });
});
