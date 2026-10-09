import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * WeatherKit の口。**外へは一度も出ない**——`fetch` と SSM と DynamoDB は全部差し替える。
 *
 * 固定したいこと:
 *  1. 鍵（SSM のパラメータ2つ）が無い・空・読めないなら**機能を止める**（外へ出ない）
 *  2. JWT の形（kid・id・iss・sub・ES256 の生の署名）
 *  3. 要求の URL（dataSets・timezone・座標の丸め）
 *  4. 応答を使う形に縮める（固定の応答で見張る）
 *  5. 同じ場所は控えから返す（WeatherKit を叩かない）
 */
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const FIXTURE = readFileSync(path.join(__dirname, "fixtures", "weatherkit-tokyo.json"), "utf8");

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
const mockSsmSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-ssm", () => ({
    SSMClient: class { send = mockSsmSend; },
    GetParametersCommand: class { constructor(public input: unknown) {} },
}));

const PREFIX = "/journey-photo/test/weatherkit";
const params = (keyId: string | null, key: string | null) => ({
    Parameters: [
        ...(keyId !== null ? [{ Name: `${PREFIX}/key-id`, Value: keyId }] : []),
        ...(key !== null ? [{ Name: `${PREFIX}/private-key`, Value: key }] : []),
    ],
    InvalidParameters: [
        ...(keyId === null ? [`${PREFIX}/key-id`] : []),
        ...(key === null ? [`${PREFIX}/private-key`] : []),
    ],
});

async function load(env: Record<string, string> = {}) {
    vi.resetModules();
    vi.stubEnv("WEATHERKIT_PARAM_PREFIX", PREFIX);
    vi.stubEnv("WEATHERKIT_TEAM_ID", "TEAM123456");
    vi.stubEnv("WEATHERKIT_SERVICE_ID", "com.example.app");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return await import("../weatherKit");
}

const fetchMock = vi.fn();
beforeEach(() => {
    mockDdbSend.mockReset();
    mockSsmSend.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

const SPOT = { lat: 35.6612, lng: 139.7634, timeZone: "Asia/Tokyo" };
const NOW = Date.parse("2026-10-09T11:00:00Z");

describe("鍵が無いあいだは機能を止める", () => {
    it("パラメータが無い → 使えない・外へ出ない", async () => {
        mockSsmSend.mockResolvedValue(params(null, null));
        const wk = await load();
        expect(await wk.weatherKitReady(NOW)).toBe(false);
        expect(await wk.getForecast(SPOT, NOW)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("空のキー ID・鍵として読めない値・SSM の失敗 → 使えない", async () => {
        let wk = await load();
        mockSsmSend.mockResolvedValue(params("", PEM));
        expect(await wk.weatherKitReady(NOW)).toBe(false);
        wk = await load();
        mockSsmSend.mockResolvedValue(params("KEY1", "not a key"));
        expect(await wk.weatherKitReady(NOW)).toBe(false);
        wk = await load();
        mockSsmSend.mockRejectedValue(new Error("AccessDenied"));
        expect(await wk.weatherKitReady(NOW)).toBe(false);
    });

    it("道の頭・チーム ID・サービス ID のどれかが空なら SSM も読まない", async () => {
        const wk = await load({ WEATHERKIT_SERVICE_ID: "" });
        expect(await wk.weatherKitReady(NOW)).toBe(false);
        expect(mockSsmSend).not.toHaveBeenCalled();
    });

    it("SecureString を復号して読む・2つを1回で読む・5分は控える", async () => {
        mockSsmSend.mockResolvedValue(params("KEY1", PEM));
        const wk = await load();
        expect(await wk.weatherKitReady(NOW)).toBe(true);
        expect(mockSsmSend.mock.calls[0][0].input).toEqual({
            Names: [`${PREFIX}/key-id`, `${PREFIX}/private-key`], WithDecryption: true,
        });
        await wk.weatherKitReady(NOW + 4 * 60_000);
        expect(mockSsmSend).toHaveBeenCalledTimes(1);
        await wk.weatherKitReady(NOW + 6 * 60_000);
        expect(mockSsmSend).toHaveBeenCalledTimes(2);
    });

    it("読めなかった回は1分だけ控える（owner が入れたら早めに効く）", async () => {
        mockSsmSend.mockResolvedValue(params(null, null));
        const wk = await load();
        await wk.weatherKitReady(NOW);
        await wk.weatherKitReady(NOW + 30_000);
        expect(mockSsmSend).toHaveBeenCalledTimes(1);
        mockSsmSend.mockResolvedValue(params("KEY1", PEM));
        expect(await wk.weatherKitReady(NOW + 61_000)).toBe(true);
    });

    it("読み込みの失敗と「パラメータが無い」を分ける。失敗のあとは retryFailed で控えを使わず読み直す", async () => {
        const wk = await load();
        mockSsmSend.mockResolvedValue(params(null, null));
        expect(await wk.weatherKitReady(NOW)).toBe(false);
        expect(wk.weatherKitKeyReadFailed()).toBe(false);
        mockSsmSend.mockRejectedValue(new Error("ThrottlingException"));
        expect(await wk.weatherKitReady(NOW + 61_000)).toBe(false);
        expect(wk.weatherKitKeyReadFailed()).toBe(true);
        // 控え（1分）の中: ふつうは読みにいかない・やり直しは読み直す
        mockSsmSend.mockReset().mockResolvedValue(params("KEY1", PEM));
        expect(await wk.weatherKitReady(NOW + 62_000)).toBe(false);
        expect(mockSsmSend).not.toHaveBeenCalled();
        expect(await wk.weatherKitReady(NOW + 63_000, { retryFailed: true })).toBe(true);
        expect(wk.weatherKitKeyReadFailed()).toBe(false);
    });

    it("鍵の改行が `\\n` の文字のまま貼られていても読む", async () => {
        const wk = await load();
        expect(wk.toWeatherKitKey(" KEY1 ", PEM.replace(/\n/g, "\\n"))?.keyId).toBe("KEY1");
    });
});

describe("署名（JWT）", () => {
    it("kid=キー ID・id=チーム.サービス・iss=チーム・sub=サービス・ES256 の生の署名", async () => {
        const wk = await load();
        const token = wk.weatherKitToken({ keyId: "KEY1", privateKey: PEM }, NOW);
        const [h, p, sig] = token.split(".");
        const dec = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());
        expect(dec(h)).toEqual({ alg: "ES256", kid: "KEY1", id: "TEAM123456.com.example.app" });
        const payload = dec(p);
        expect(payload).toMatchObject({ iss: "TEAM123456", sub: "com.example.app", iat: NOW / 1000 });
        expect(payload.exp - payload.iat).toBe(3600);
        const raw = Buffer.from(sig, "base64url");
        expect(raw.length).toBe(64);   // DER ではなく R||S
        expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey(PEM), dsaEncoding: "ieee-p1363" }, raw)).toBe(true);
    });

    it("鍵を入れ替えたら作り直す", async () => {
        const wk = await load();
        const a = wk.weatherKitToken({ keyId: "KEY1", privateKey: PEM }, NOW);
        expect(wk.weatherKitToken({ keyId: "KEY1", privateKey: PEM }, NOW + 60_000)).toBe(a);
        expect(wk.weatherKitToken({ keyId: "KEY2", privateKey: PEM }, NOW + 60_000)).not.toBe(a);
    });
});

describe("要求と応答", () => {
    it("URL: 日々と時間ごとの予報・現地の時刻帯・座標は約1km に丸める", async () => {
        const wk = await load();
        const u = new URL(wk.weatherUrl(SPOT.lat, SPOT.lng, SPOT.timeZone, NOW));
        expect(u.origin + u.pathname).toBe("https://weatherkit.apple.com/api/v1/weather/ja/35.66/139.76");
        expect(u.searchParams.get("dataSets")).toBe("forecastDaily,forecastHourly");
        expect(u.searchParams.get("timezone")).toBe("Asia/Tokyo");
        expect(u.searchParams.get("hourlyStart")).toBe("2026-10-09T11:00:00.000Z");
        // 7日の一覧＋夜景の窓まで届く長さ
        expect(Date.parse(u.searchParams.get("hourlyEnd")!) - NOW).toBeGreaterThanOrEqual(7.5 * 86_400_000);
    });

    it("固定の応答を使う形に縮める（壊れた行は捨てる）", async () => {
        const wk = await load();
        const json = JSON.parse(FIXTURE);
        json.forecastHourly.hours.push({ forecastStart: "bad", cloudCover: 0.1 }, { forecastStart: "2026-10-12T00:00:00Z" });
        const wx = wk.parseWeather(json, NOW);
        expect(wx.hours).toHaveLength(60);
        expect(wx.hours[0]).toEqual({ t: NOW, cloud: 0.9, low: 0.8, mid: 0.5, high: 0.3, rain: 0.1, vis: 24_000, hum: 0.7, code: "Cloudy" });
        expect(wk.parseWeather(null, NOW).hours).toEqual([]);
    });

    it("読んだら控えに書き、次は控えから（WeatherKit を叩かない）", async () => {
        mockSsmSend.mockResolvedValue(params("KEY1", PEM));
        mockDdbSend.mockResolvedValueOnce({}); // 控えなし
        mockDdbSend.mockResolvedValue({});
        fetchMock.mockResolvedValue(new Response(FIXTURE, { status: 200 }));
        const wk = await load();
        const wx = await wk.getForecast(SPOT, NOW);
        expect(wx?.hours).toHaveLength(60);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
        const put = mockDdbSend.mock.calls.find((c) => "Item" in c[0].input)![0].input;
        expect(put.Item.id).toBe("wxcache#35.66,139.76,Asia/Tokyo");
        // 同じコンテナ・1時間以内はメモから
        await wk.getForecast(SPOT, NOW + 30 * 60_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("DynamoDB の控えが新しければ使う・古ければ読み直す", async () => {
        mockSsmSend.mockResolvedValue(params("KEY1", PEM));
        const wk = await load();
        mockDdbSend.mockResolvedValueOnce({ Item: { hours: [{ t: NOW, cloud: 0.1, rain: 0, code: "Clear" }], fetchedAt: NOW - 10 * 60_000 } });
        expect((await wk.getForecast(SPOT, NOW))?.hours[0].code).toBe("Clear");
        expect(fetchMock).not.toHaveBeenCalled();

        wk.resetWeatherMemo();
        mockDdbSend.mockResolvedValueOnce({ Item: { hours: [], fetchedAt: NOW - 61 * 60_000 } });
        mockDdbSend.mockResolvedValue({});
        fetchMock.mockResolvedValue(new Response(FIXTURE, { status: 200 }));
        await wk.getForecast(SPOT, NOW);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("WeatherKit が断ったら null（投げない）。401 なら鍵も読み直す", async () => {
        mockSsmSend.mockResolvedValue(params("KEY1", PEM));
        mockDdbSend.mockResolvedValue({});
        fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
        const wk = await load();
        expect(await wk.getForecast(SPOT, NOW)).toBeNull();
        expect(mockSsmSend).toHaveBeenCalledTimes(1);
        await wk.getForecast(SPOT, NOW + 1000);
        expect(mockSsmSend).toHaveBeenCalledTimes(2);
        fetchMock.mockRejectedValue(new Error("timeout"));
        expect(await wk.getForecast(SPOT, NOW + 2000)).toBeNull();
    });
});
