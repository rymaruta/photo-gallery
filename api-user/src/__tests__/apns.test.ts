import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";

// **本物の鍵で署名を確かめる。** 署名の形（ES256 の生の R||S）を間違えると
// APNs は 403 `InvalidProviderToken` を返す——「鍵が違う」に見えて実際は
// 形式違い、といういちばん分かりにくい落ち方をする。
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return await import("../apns");
}

beforeEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe("設定が無いとき", () => {
    /// **鍵を入れていない環境で通知そのものを止めない。**
    /// staging と手元はこの状態で動く（`CLOUDFRONT_DISTRIBUTION_ID` と同じ扱い）。
    it("送らないし、投げない", async () => {
        const { apnsConfigured, sendPush } = await load({
            APNS_KEY_ID: "", APNS_TEAM_ID: "", APNS_PRIVATE_KEY: "", APNS_TOPIC: "",
        });
        expect(apnsConfigured()).toBe(false);
        expect(await sendPush(["a".repeat(64)], { locKey: "NOTIF_LIKE", locArgs: ["たろう"] }))
            .toEqual({ sent: 0, invalid: [] });
    });

    it("鍵が1つでも欠けていれば「未設定」", async () => {
        const { apnsConfigured } = await load({
            APNS_KEY_ID: "K1", APNS_TEAM_ID: "T1", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "",
        });
        expect(apnsConfigured()).toBe(false);
    });
});

describe("署名（JWT）", () => {
    it("ES256 の生の署名で、ヘッダに鍵の ID が入る", async () => {
        const { providerToken } = await load({
            APNS_KEY_ID: "KEYID12345", APNS_TEAM_ID: "TEAMID6789",
            APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "com.example.app",
        });
        const [header, payload, signature] = providerToken().split(".");
        const decode = (s: string) =>
            JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

        expect(decode(header)).toEqual({ alg: "ES256", kid: "KEYID12345" });
        expect(decode(payload).iss).toBe("TEAMID6789");
        // **DER ではなく生の 64 バイト**（`ieee-p1363`）
        expect(Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64").length).toBe(64);
        // `=` パディングは付けない（JWT は base64url）
        expect(signature.includes("=")).toBe(false);
    });

    /// APNs は**1時間以内の更新**を求め、**20分より短い更新は断る**
    /// （`TooManyProviderTokenUpdates`）。50分で作り直せば両方を満たす。
    it("50分は使い回し、超えたら作り直す", async () => {
        const { providerToken, resetProviderToken } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "t",
        });
        resetProviderToken();
        const first = providerToken(1_000_000);
        expect(providerToken(1_000_000 + 40 * 60 * 1000)).toBe(first);
        expect(providerToken(1_000_000 + 51 * 60 * 1000)).not.toBe(first);
    });
});

describe("送る中身と、宛先を捨てる判断", () => {
    /// **HTTP/2 の向こう側は手元で再現できない。** だから形だけは必ず縛る
    /// ——ここを壊すと本番の端末トークンを消すのに、テストは緑のままになる。
    it("loc-key を送る（文面は作らない）", async () => {
        const { pushPayload } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "com.example.app",
        });
        const payload = JSON.parse(pushPayload({
            locKey: "NOTIF_LIKE", locArgs: ["たろう"], badge: 3,
            data: { type: "like", photoId: "p1" },
        }));

        expect(payload.aps.alert).toEqual({ "loc-key": "NOTIF_LIKE", "loc-args": ["たろう"] });
        expect(payload.aps.badge).toBe(3);
        // 押したときの行き先は付帯情報として運ぶ
        expect(payload.photoId).toBe("p1");
        // **文面そのものは入れない**（サーバーは相手の言語を知らない）
        expect(JSON.stringify(payload)).not.toContain("いいね");
    });

    it("バッジが無ければ載せない（0 と「無し」を混ぜない）", async () => {
        const { pushPayload } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "t",
        });
        expect(JSON.parse(pushPayload({ locKey: "NOTIF_FOLLOW", locArgs: ["はなこ"] })).aps.badge)
            .toBeUndefined();
    });

    it("宛先と話題（Bundle ID）をヘッダに載せる", async () => {
        const { pushHeaders } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM,
            APNS_TOPIC: "com.journeyphoto.JourneyPhoto",
        });
        const headers = pushHeaders("JWT", "a".repeat(64));
        expect(headers[":path"]).toBe(`/3/device/${"a".repeat(64)}`);
        expect(headers["apns-topic"]).toBe("com.journeyphoto.JourneyPhoto");
        expect(headers["authorization"]).toBe("bearer JWT");
        expect(headers["apns-push-type"]).toBe("alert");
    });

    /// **捨てるのは2つだけ。** こちらの間違い（`PayloadTooLarge` など）で
    /// 宛先を捨てると、直したあとも誰にも届かない。
    it("無効な宛先だけを捨てる", async () => {
        const { isDeadToken } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "t",
        });
        expect(isDeadToken(410, "Unregistered")).toBe(true);
        expect(isDeadToken(400, "BadDeviceToken")).toBe(true);
        expect(isDeadToken(400, "DeviceTokenNotForTopic")).toBe(true);
        expect(isDeadToken(400, "PayloadTooLarge")).toBe(false);
        expect(isDeadToken(429, "TooManyRequests")).toBe(false);
        expect(isDeadToken(500)).toBe(false);
        expect(isDeadToken(200)).toBe(false);
    });

    /// **403 を放っておくと、温まったコンテナは50分ずっと失敗し続ける。**
    it("断られた署名は作り直す", async () => {
        const { shouldResignAfter } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "t",
        });
        expect(shouldResignAfter(403, "ExpiredProviderToken")).toBe(true);
        expect(shouldResignAfter(403, "InvalidProviderToken")).toBe(true);
        // 403 でも「その話題に送る権限が無い」は署名の問題ではない
        expect(shouldResignAfter(403, "TopicDisallowed")).toBe(false);
        expect(shouldResignAfter(410, "Unregistered")).toBe(false);
    });
});
