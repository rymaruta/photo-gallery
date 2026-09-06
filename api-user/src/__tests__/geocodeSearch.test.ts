import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocodeSearch, mapNominatimResults, FETCH_TIMEOUT_MS } from "../geocodeSearch";

// 撮影地の位置さがし（Nominatim の代理）。
// **画面から直接叩かない**——利用者の IP を相手に渡さず、規約が求める
// User-Agent をこちらで名乗る。打鍵ごとではなく「探す」を押したときだけ。

type Result = { statusCode: number; body: string; headers?: Record<string, string> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (q?: string): Promise<Result> => (geocodeSearch as any)({ queryStringParameters: q === undefined ? undefined : { q } });

const fetchMock = vi.fn();
let prevFetch: typeof globalThis.fetch;
beforeEach(() => { prevFetch = globalThis.fetch; globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch; fetchMock.mockReset(); });
afterEach(() => { globalThis.fetch = prevFetch; });

const ok = (rows: unknown) => ({ ok: true, json: async () => rows });

describe("mapNominatimResults", () => {
    // **約1km（小数2桁）に丸める。** アップロードの `sanitizeCoords` と同じ精度で、
    // 地図のピンの粒度もこれに揃えてある。本人が選んだ場所でも、
    // 自宅が特定できる細かさでは残さない
    it("座標を約1kmに丸め、表示名を添える", () => {
        expect(mapNominatimResults([{ lat: "33.5901838", lon: "130.4016888", display_name: "福岡市, 福岡県" }]))
            .toEqual([{ label: "福岡市, 福岡県", lat: 33.59, lng: 130.4 }]);
    });

    it("読めない行・名前の無い行・範囲外は落とす", () => {
        expect(mapNominatimResults([
            null,
            { lat: "abc", lon: "1", display_name: "x" },
            { lat: "91", lon: "1", display_name: "極地の外" },
            { lat: "1", lon: "2" },                       // 名前が無い
            { lat: "35.68", lon: "139.76", display_name: "東京都, 日本" },
        ])).toEqual([{ label: "東京都, 日本", lat: 35.68, lng: 139.76 }]);
    });

    it("配列でなければ空", () => {
        expect(mapNominatimResults({ results: [] })).toEqual([]);
        expect(mapNominatimResults(null)).toEqual([]);
    });
});

describe("geocodeSearch", () => {
    it("地名が無ければ 400（外に投げない）", async () => {
        const res = await invoke("   ");
        expect(res.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("候補を返す。相手には名乗り、打ち切りを付ける", async () => {
        fetchMock.mockResolvedValue(ok([{ lat: "33.59", lon: "130.40", display_name: "福岡市, 福岡県" }]));
        const res = await invoke("福岡");
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).results).toEqual([{ label: "福岡市, 福岡県", lat: 33.59, lng: 130.4 }]);

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(decodeURIComponent(url)).toContain("q=福岡");
        expect(decodeURIComponent(url)).toContain("limit=5");
        // Nominatim の規約: 識別できる User-Agent
        expect(init.headers["User-Agent"]).toMatch(/journey-photo/);
        expect(init.signal, "外向き通信に打ち切りが無い").toBeTruthy();
    });

    it("長すぎる地名は切ってから投げる", async () => {
        fetchMock.mockResolvedValue(ok([]));
        await invoke("あ".repeat(300));
        const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
        expect(url.split("q=")[1].length).toBe(100);
    });

    it("相手が 5xx なら 502（理由を伝える）", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503 });
        const res = await invoke("福岡");
        expect(res.statusCode).toBe(502);
        expect(JSON.parse(res.body).error).toBeTruthy();
    });

    it("打ち切りに掛かっても 500 で畳む（Lambda を握ったままにしない）", async () => {
        fetchMock.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
        const res = await invoke("福岡");
        expect(res.statusCode).toBe(500);
    });

    // この関数の Lambda タイムアウトは6秒（serverless.yml）。
    // 外向きはそれより短くないと、返らない相手のせいで枠を握り続ける
    it("外向きの打ち切りは Lambda のタイムアウトより短い", () => {
        expect(FETCH_TIMEOUT_MS).toBeLessThan(6000);
    });
});
