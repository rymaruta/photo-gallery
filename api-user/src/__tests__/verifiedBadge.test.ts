import { describe, it, expect, vi } from "vitest";

vi.mock("../dynamodb", () => ({
    ddb: { send: vi.fn() },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));

const { toPublicProfile, mergeProfile } = await import("../userProfile");

describe("認証済みの印", () => {
    it("立っていれば公開のプロフィールに出る（バッジを描くため）", () => {
        const pub = toPublicProfile({ userId: "u1", displayName: "A", verified: true });
        expect(pub.verified).toBe(true);
    });

    /// **誰も立てていなければ誰にも出ない。** それは正しい状態であって
    /// 「機能が無い」のではない
    it("立っていなければ出ない", () => {
        expect(toPublicProfile({ userId: "u1" }).verified).toBeUndefined();
    });

    /// **本人からは立てられない。** ここは本人が書き換えられる行なので、
    /// 更新の経路が受け取ると誰でも自分にバッジを付けられる
    it("更新の経路は verified を受け取らない（whitelist の外）", async () => {
        const src = await import("node:fs").then((fs) =>
            fs.readFileSync("api-user/src/userProfile.ts", "utf8"));
        expect(src).not.toMatch(/apply\("verified"/);
        // 一括で流し込む書き方が紛れていないことも見る
        expect(src).not.toMatch(/Object\.assign\(changes/);
        expect(src).not.toMatch(/changes\s*=\s*\{\s*\.\.\.body/);
    });

    /// 運営が直に立てた印は、本人が別の項目を保存しても消えない
    it("本人の保存で印が落ちない", () => {
        const merged = mergeProfile({ userId: "u1", verified: true }, "u1", { bio: "こんにちは" });
        expect(merged.verified).toBe(true);
        expect(merged.bio).toBe("こんにちは");
    });
});
