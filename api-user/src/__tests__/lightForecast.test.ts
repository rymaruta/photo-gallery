import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 光と天気の知らせ（`GET /user/light-forecast` と 20:00 の定期実行）。
 *
 * 固定したいこと:
 *  1. ログイン必須・**Pro の人だけ**（Pro でなければ 403）・鍵が無ければ 503
 *  2. 「行きたい場所」のうち公式スポットの鍵（`SPOT-`）だけ・現地の時計で7日
 *  3. 知らせは **Pro で受け取る設定の人に1通だけ**・「見込み 高」が無ければ送らない
 *  4. **同じ日に二度送らない**（定期実行のやり直しで重ならない）
 *  5. 鍵（WeatherKit・APNs）が無ければ何も送らない
 *
 * 天気は固定の応答（`fixtures/weatherkit-tokyo.json`）。外へは出ない。
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test", USER_INDEX: "idx" }));

const wk = vi.hoisted(() => ({ ready: vi.fn(), forecast: vi.fn(), failed: vi.fn(() => false) }));
vi.mock("../weatherKit", async (orig) => ({
    ...(await orig<typeof import("../weatherKit")>()),
    weatherKitReady: wk.ready,
    weatherKitKeyReadFailed: wk.failed,
    getForecast: wk.forecast,
}));
const push = vi.hoisted(() => ({ configured: vi.fn(), send: vi.fn() }));
vi.mock("../apns", () => ({ apnsConfigured: push.configured, sendPush: push.send }));
const dev = vi.hoisted(() => ({ tokens: vi.fn(), forget: vi.fn() }));
vi.mock("../devices", () => ({ deviceTokens: dev.tokens, forgetTokens: dev.forget }));

import { ALERT_PARALLEL, getLightForecast, sendLightAlerts, wantsLightAlert, lightAlertMarkId } from "../lightForecast";
import { parseWeather } from "../weatherKit";

const NOW = new Date("2026-10-09T11:00:00Z");   // 20:00 JST
const WX = parseWeather(JSON.parse(readFileSync(path.join(__dirname, "fixtures", "weatherkit-tokyo.json"), "utf8")), NOW.getTime());
const PRO = { active: true, expiresAt: "2027-01-01T00:00:00Z" };

type Rows = { users: Record<string, Record<string, unknown>>; lists: Record<string, string[]>; marks: Record<string, string> };
let rows: Rows;

/** DynamoDB の代役（読む行・Scan・印の条件付き書き込み） */
function fakeDdb() {
    type Input = { TableName: string; Key: { id: string; userId: string }; ExpressionAttributeValues: Record<string, string> };
    mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Input }) => {
        const name = cmd.constructor.name;
        const input = cmd.input;
        if (name === "GetCommand") {
            if (input.TableName === "photos-test") {
                const list = rows.lists[input.Key.id];
                return { Item: list ? { id: input.Key.id, list } : undefined };
            }
            return { Item: rows.users[input.Key.userId] };
        }
        if (name === "ScanCommand") {
            return { Items: Object.values(rows.users).filter((u) => u.supporter && !u.deletedAt) };
        }
        if (name === "UpdateCommand") {
            const id = input.Key.id as string;
            const day = input.ExpressionAttributeValues[":d"];
            if (rows.marks[id] === day) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
            rows.marks[id] = day;
            return {};
        }
        throw new Error(`unexpected ${name}`);
    });
}

const ev = (sub: string) => ({ requestContext: { authorizer: { jwt: { claims: { sub } } } } }) as never;
const run = async (sub: string) => (await getLightForecast(ev(sub), {} as never, () => undefined)) as { statusCode: number; body: string; headers: Record<string, string> };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    rows = {
        users: {
            pro: { userId: "pro", supporter: PRO },
            free: { userId: "free" },
            lapsed: { userId: "lapsed", supporter: { active: true, expiresAt: "2026-01-01T00:00:00Z" } },
            off: { userId: "off", supporter: PRO, lightAlert: false },
        },
        lists: {
            // 新しい順。撮影地のスラッグ（接頭辞なし）と、写しに無いスポットは出さない
            "spots#pro": ["パリ", "SPOT-hamarikyu", "SPOT-no-such-spot", "SPOT-amiens-cathedral"],
            "spots#off": ["SPOT-hamarikyu"],
            "spots#lapsed": ["SPOT-hamarikyu"],
        },
        marks: {},
    };
    mockDdbSend.mockReset();
    fakeDdb();
    wk.ready.mockReset().mockResolvedValue(true);
    wk.failed.mockReset().mockReturnValue(false);
    // 東京の場所だけ予報が読める（パリは読めなかった扱い）
    wk.forecast.mockReset().mockImplementation(async (s: { timeZone: string }) => (s.timeZone === "Asia/Tokyo" ? WX : null));
    push.configured.mockReset().mockReturnValue(true);
    push.send.mockReset().mockResolvedValue({ sent: 1, invalid: [] });
    dev.tokens.mockReset().mockResolvedValue(["a".repeat(64)]);
    dev.forget.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe("GET /user/light-forecast", () => {
    it("ログインしていなければ 401", async () => {
        expect((await run("")).statusCode).toBe(401);
    });

    it("鍵が無ければ 503（Pro でも）", async () => {
        wk.ready.mockResolvedValue(false);
        expect((await run("pro")).statusCode).toBe(503);
        expect(wk.forecast).not.toHaveBeenCalled();
    });

    it("Pro でなければ 403（期限の切れた Pro も）", async () => {
        expect((await run("free")).statusCode).toBe(403);
        expect((await run("lapsed")).statusCode).toBe(403);
        expect(wk.forecast).not.toHaveBeenCalled();
    });

    it("Pro: 公式スポットだけ・新しい順・現地の時計で7日・注記と出典", async () => {
        const res = await run("pro");
        expect(res.statusCode).toBe(200);
        expect(res.headers["Cache-Control"]).toMatch(/^private/);
        const body = JSON.parse(res.body);
        expect(body.places.map((p: { slug: string }) => p.slug)).toEqual(["hamarikyu", "amiens-cathedral"]);
        const [tokyo, amiens] = body.places;
        expect(tokyo).toMatchObject({ key: "SPOT-hamarikyu", name: "浜離宮恩賜庭園", timeZone: "Asia/Tokyo", forecast: true });
        expect(tokyo.days).toHaveLength(7);
        expect(tokyo.days[1]).toMatchObject({ date: "2026-10-10", morning: { weather: "partlyCloudy", chance: "high" }, evening: { weather: "rain", chance: "low" } });
        // 予報が読めなかった場所も、光の時刻は出す（見込みは null）
        expect(amiens).toMatchObject({ timeZone: "Europe/Paris", forecast: false });
        expect(amiens.days[1].sunrise.clock).toMatch(/^0[78]:\d\d$/);   // パリの10月の日の出（現地の時計）
        expect(amiens.days[1].morning).toBeNull();
        expect(body.note).toBe("天気は外部の予報から。光の時刻はアプリで計算。見込みは目安で、外れることがあります。");
        expect(body.attribution.serviceName).toBe("Apple Weather");
    });
});

describe("前の晩の知らせ（sendLightAlerts）", () => {
    it("受け取る設定は既定で「受け取る」", () => {
        expect(wantsLightAlert({})).toBe(true);
        expect(wantsLightAlert({ lightAlert: true })).toBe(true);
        expect(wantsLightAlert({ lightAlert: false })).toBe(false);
    });

    it("Pro で受け取る人にだけ、1通・文面そのもの（鍵ではない）・バッジは触らない", async () => {
        const r = await sendLightAlerts();
        expect(r).toEqual({ recipients: 1, sent: 1 });   // pro だけ（free・lapsed・off は対象外）
        expect(push.send).toHaveBeenCalledTimes(1);
        const [tokens, msg] = push.send.mock.calls[0];
        expect(tokens).toEqual(["a".repeat(64)]);
        expect(msg.title).toBe("明日の朝、浜離宮恩賜庭園 が朝焼けになりそうです");
        expect(msg.body).toMatch(/^日の出 5:\d\d・朝焼けの見込み 高い。\d:\d\d に着いていれば間に合います。$/);
        // 🔴 新しい loc-key を送ると古いアプリでは鍵の文字列のまま出る
        expect(msg.locKey).toBeUndefined();
        expect(msg.badge).toBeUndefined();
        expect(msg.data).toEqual({ type: "light", spot: "hamarikyu", kind: "sunrise", date: "2026-10-10" });
        expect(rows.marks[lightAlertMarkId("pro")]).toBe("2026-10-09");
    });

    // 🔴 本物の WeatherKit は層ごとの雲量を返さない（2026-10-09）。その形でも知らせが届くこと
    it("層ごとの雲量が無い予報（いまの本物の形）でも送る", async () => {
        const j = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "weatherkit-tokyo.json"), "utf8"));
        for (const h of j.forecastHourly.hours) {
            delete h.cloudCoverLowAltPct; delete h.cloudCoverMidAltPct; delete h.cloudCoverHighAltPct;
        }
        wk.forecast.mockResolvedValue(parseWeather(j, NOW.getTime()));
        expect(await sendLightAlerts()).toEqual({ recipients: 1, sent: 1 });
        expect(push.send.mock.calls[0][1].title).toBe("明日の朝、浜離宮恩賜庭園 が朝焼けになりそうです");
    });

    it("同じ日に二度送らない（定期実行のやり直し）", async () => {
        await sendLightAlerts();
        await sendLightAlerts();
        expect(push.send).toHaveBeenCalledTimes(1);
    });

    it("「見込み 高」が無ければ送らない・印も立てない", async () => {
        wk.forecast.mockResolvedValue(null);
        expect(await sendLightAlerts()).toEqual({ recipients: 1, sent: 0 });
        expect(push.send).not.toHaveBeenCalled();
        expect(rows.marks).toEqual({});
    });

    it("端末が無い人には予報も読まない（WeatherKit の呼び出しを使わない）", async () => {
        dev.tokens.mockResolvedValue([]);
        await sendLightAlerts();
        expect(wk.forecast).not.toHaveBeenCalled();
        expect(push.send).not.toHaveBeenCalled();
    });

    it("鍵（WeatherKit か APNs）が無ければ誰も見ない・送らない", async () => {
        wk.ready.mockResolvedValue(false);
        expect(await sendLightAlerts()).toEqual({ recipients: 0, sent: 0 });
        wk.ready.mockResolvedValue(true);
        push.configured.mockReturnValue(false);
        expect(await sendLightAlerts()).toEqual({ recipients: 0, sent: 0 });
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(push.send).not.toHaveBeenCalled();
    });

    it("鍵を読めなかった（SSM の一時的な失敗）なら投げて、定期実行にやり直させる（その日の知らせを落とさない）", async () => {
        wk.ready.mockResolvedValue(false);
        wk.failed.mockReturnValue(true);
        await expect(sendLightAlerts()).rejects.toThrow(/SSM/);
        // やり直しは失敗の控えを使わず読み直す
        expect(wk.ready).toHaveBeenCalledWith(expect.any(Number), { retryFailed: true });
        expect(push.send).not.toHaveBeenCalled();
    });

    it("無効になった端末は外す", async () => {
        push.send.mockResolvedValue({ sent: 0, invalid: ["a".repeat(64)] });
        await sendLightAlerts();
        expect(dev.forget).toHaveBeenCalledWith("pro", ["a".repeat(64)]);
    });

    it("1人の失敗で全体を止めない", async () => {
        rows.users.pro2 = { userId: "pro2", supporter: PRO };
        rows.lists["spots#pro2"] = ["SPOT-hamarikyu"];
        dev.tokens.mockImplementation(async (uid: string) => { if (uid === "pro") throw new Error("boom"); return ["b".repeat(64)]; });
        expect(await sendLightAlerts()).toEqual({ recipients: 2, sent: 1 });
    });

    // 1人ずつだと人数に比例して伸び、Lambda の時間を使い切る。並べて回るが、並べすぎない
    it("何人かを並べて回る（同時に回るのは ALERT_PARALLEL 人まで）・全員に1通ずつ", async () => {
        const n = 30;
        for (let i = 0; i < n; i++) {
            rows.users[`p${i}`] = { userId: `p${i}`, supporter: PRO };
            rows.lists[`spots#p${i}`] = ["SPOT-hamarikyu"];
        }
        let active = 0;
        let peak = 0;
        dev.tokens.mockImplementation(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 1));
            active--;
            return ["c".repeat(64)];
        });
        expect(await sendLightAlerts()).toEqual({ recipients: n + 1, sent: n + 1 });
        expect(ALERT_PARALLEL).toBe(8);
        expect(peak).toBe(ALERT_PARALLEL);
        expect(push.send).toHaveBeenCalledTimes(n + 1);
    });
});
