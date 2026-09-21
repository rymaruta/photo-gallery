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
