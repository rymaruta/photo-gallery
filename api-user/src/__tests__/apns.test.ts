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

/**
 * 🔴 **宛先を消す判断の見張り。**
 *
 * 切り出す前は `sendPush` を走らせるテストが1本も無く、
 * `isDeadToken(status, reason)` を **`status !== 200` に書き換えても
 * 42件とも緑**だった（2026-09-25 に変異で実測）。ネットワーク不通や
 * APNs の 500 で宛先を消す実装に退化しても誰も気づけなかった。
 *
 * 消えた宛先は**利用者が再インストールするまで戻らない**。
 * `apns.ts` の冒頭が「ここを壊すと本番の端末トークンを消すのに、
 * テストは緑のままになる」と書いている、まさにその場所。
 */
describe("応答の判定（宛先を消すかどうか）", () => {
    const env = { APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "t", APNS_HOST: "h" };
    const T = "a".repeat(64);
    const body = (reason: string) => JSON.stringify({ reason });

    it("死んだ宛先だけを invalid にする", async () => {
        const { classifyResponse } = await load(env);
        expect(classifyResponse(T, 410, body("Unregistered")).invalid, "410 を外していない").toBe(true);
        expect(classifyResponse(T, 400, body("BadDeviceToken")).invalid).toBe(true);
        expect(classifyResponse(T, 400, body("DeviceTokenNotForTopic")).invalid).toBe(true);
    });

    // **ここが本題。** 送信の失敗で外すと、直したあとも届かない
    it.each([
        [500, "InternalServerError"],
        [503, "ServiceUnavailable"],
        [429, "TooManyRequests"],
        [400, "PayloadTooLarge"],
        [403, "InvalidProviderToken"],
        [413, "PayloadTooLarge"],
    ])("%i %s では外さない（送信の失敗を「死んだ宛先」と混ぜない）", async (status, reason) => {
        const { classifyResponse } = await load(env);
        const v = classifyResponse(T, status, body(reason));
        expect(v.invalid, `${status} ${reason} で宛先を消している`).toBe(false);
        expect(v.ok).toBe(false);
    });

    it("200 は成功で、外さない", async () => {
        const { classifyResponse } = await load(env);
        expect(classifyResponse(T, 200, "")).toMatchObject({ ok: true, invalid: false, resign: false });
    });

    // 本文が空・壊れていても落ちない（APNs は 200 で本文を返さない）
    it("理由が読めない応答でも外さない", async () => {
        const { classifyResponse } = await load(env);
        for (const payload of ["", "{", "null", "[]"]) {
            expect(classifyResponse(T, 500, payload).invalid, JSON.stringify(payload)).toBe(false);
        }
    });

    it("まとめるときも、invalid に入ったものだけを渡す", async () => {
        const { aggregate } = await load(env);
        expect(aggregate([
            { token: "t1", ok: true, invalid: false },
            { token: "t2", ok: false, invalid: false },   // 送信の失敗
            { token: "t3", ok: false, invalid: true },    // 死んだ宛先
        ])).toEqual({ sent: 1, invalid: ["t3"] });
    });
});

/**
 * 🔴 **`APNS_HOST` に既定値を置かない。**
 *
 * 以前は `|| "api.push.apple.com"` だった。鍵だけ入って host が空だと
 * staging から本番の APNs を向き、sandbox のトークンが 400
 * `BadDeviceToken` を受けて**消される**（`classifyResponse` は正しく
 * 動いているのに救えない形）。
 */
describe("送り先（APNS_HOST）", () => {
    it("host が空なら「未設定」＝送らない", async () => {
        const { apnsConfigured } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "t", APNS_HOST: "",
        });
        expect(apnsConfigured(), "host が無いのに本番へ送ろうとしている").toBe(false);
    });

    it("5つ揃って初めて「設定済み」", async () => {
        const { apnsConfigured } = await load({
            APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM,
            APNS_TOPIC: "t", APNS_HOST: "api.sandbox.push.apple.com",
        });
        expect(apnsConfigured()).toBe(true);
    });
});

/**
 * 🔴 **403 が続くときに 429 へ悪化させない。**
 *
 * `InvalidProviderToken` は期限切れではなく**設定ミス**（Key ID と鍵の
 * 不一致・失効・Team ID 違い）でも返る。下限が無いと「いいね1回ごとに
 * 新しい JWT」になり、APNs の「20分より短い間隔で作り直すと断る」に当たって
 * `TooManyProviderTokenUpdates` に変わる。**直したあとも 429 が続くぶん、
 * 届かない時間が伸びる。**
 */
describe("署名の作り直しの下限", () => {
    const env = { APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: PEM, APNS_TOPIC: "t", APNS_HOST: "h" };

    it("まだ一度も署名していなければ作り直せる", async () => {
        const { canResign } = await load(env);
        expect(canResign()).toBe(true);
    });

    it("作った直後は作り直さない（20分の壁を守る）", async () => {
        const { canResign, providerToken } = await load(env);
        const t0 = 1_800_000_000_000;
        providerToken(t0);
        expect(canResign(t0 + 60_000), "1分後に作り直そうとしている").toBe(false);
        expect(canResign(t0 + 19 * 60_000), "19分後に作り直そうとしている").toBe(false);
    });

    it("20分を過ぎたら作り直せる", async () => {
        const { canResign, providerToken } = await load(env);
        const t0 = 1_800_000_000_000;
        providerToken(t0);
        expect(canResign(t0 + 20 * 60_000)).toBe(true);
    });

    // 期限切れ（50分）で作り直す従来の道は塞がない
    it("使い回しの期限（50分）とは両立する", async () => {
        const { providerToken } = await load(env);
        const t0 = 1_800_000_000_000;
        const a = providerToken(t0);
        expect(providerToken(t0 + 49 * 60_000), "50分未満で作り直している").toBe(a);
        expect(providerToken(t0 + 51 * 60_000)).not.toBe(a);
    });
});
