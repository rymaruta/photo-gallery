import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// 控え（DynamoDB）は差し替える。**規約は「結果はこちらでキャッシュせよ」**と
// 求めるので、当たれば相手に投げない・外れれば投げて控える、を固定する
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));

import { geocodeSearch, geocodeReverse, mapNominatimResults, placeNameFromReverse, FETCH_TIMEOUT_MS, CACHE_TTL_MS } from "../geocodeSearch";

// 撮影地の位置さがし（Nominatim の代理）。
// **画面から直接叩かない**——利用者の IP を相手に渡さず、規約が求める
// User-Agent をこちらで名乗る。打鍵ごとではなく「探す」を押したときだけ。

type Result = { statusCode: number; body: string; headers?: Record<string, string> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (q?: string): Promise<Result> => (geocodeSearch as any)({ queryStringParameters: q === undefined ? undefined : { q } });

const fetchMock = vi.fn();
let prevFetch: typeof globalThis.fetch;
beforeEach(() => {
    prevFetch = globalThis.fetch; globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch; fetchMock.mockReset();
    // 既定: 控えは空（Get → Item 無し、Put → 成功）
    mockDdbSend.mockReset().mockResolvedValue({});
});
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
        // **生の URL で見る。** `decodeURIComponent` してから数えると、
        // `encodeURIComponent` を外しても同じ結果になって素通りする
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url.split("q=")[1]).toBe(encodeURIComponent("あ".repeat(100)));
    });

    // **値だけをエンコードする。** 生のまま繋ぐと、地名に `&limit=50` と
    // 書くだけで相手に別のパラメータを渡せる
    it("地名は値としてエンコードして渡す（パラメータを割り込ませない）", async () => {
        fetchMock.mockResolvedValue(ok([]));
        await invoke("福岡&limit=50#x");
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain("q=%E7%A6%8F%E5%B2%A1%26limit%3D50%23x");
        expect(url.split("limit=").length, "limit が2つ入っている").toBe(2);
    });

    // 100文字目がサロゲートペアの途中だと `encodeURIComponent` が投げる。
    // URL の組み立てが try の外にあると、JSON のエラー本文もログも通らずに落ちる
    it("100文字目が絵文字でも、素の例外で落ちない", async () => {
        fetchMock.mockResolvedValue(ok([]));
        const q = "あ".repeat(99) + "🌸" + "い".repeat(50);
        const res = await invoke(q);
        expect([200, 500]).toContain(res.statusCode);
        expect(() => JSON.parse(res.body), "本文が JSON でない").not.toThrow();
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

    // **秒数は `serverless.yml` から読む**（`musicSearch.test.ts` と同じ手）。
    // 両方に書いた数字は必ずずれるので、実物を見て突き合わせる。
    // ベタ書きの 6000 と比べていた頃は、yml を `timeout: 3` に縮めても緑だった
    it("打ち切りは Lambda のタイムアウトより十分手前", () => {
        const yml = readFileSync(join(__dirname, "..", "..", "serverless.yml"), "utf8");
        const block = /^ {2}geocodeSearch:$([\s\S]*?)(?=^ {2}\w+:$)/m.exec(yml);
        expect(block, "geocodeSearch のブロックが見つからない").not.toBeNull();
        const t = /^ {4}timeout:\s*(\d+)\s*$/m.exec(block![1].replace(/^\s*#.*$/gm, ""));
        expect(t, "geocodeSearch に timeout が明示されていない").not.toBeNull();

        const lambdaMs = Number(t![1]) * 1000;
        expect(FETCH_TIMEOUT_MS).toBeLessThan(lambdaMs);
        // JSON の読み取りと整形のぶんを残す
        expect(lambdaMs - FETCH_TIMEOUT_MS, "残り時間が短すぎる").toBeGreaterThanOrEqual(2000);
    });

});

describe("結果の控え（Nominatim の規約: キャッシュせよ）", () => {
    const putCalls = () => mockDdbSend.mock.calls.map((c) => c[0]).filter((cmd) => cmd?.constructor?.name === "PutCommand");
    const cached = (ageMs: number) => ({
        Item: { id: "geocache#福岡", results: [{ label: "福岡市, 福岡県", lat: 33.59, lng: 130.4 }], cachedAt: Date.now() - ageMs },
    });

    it("控えがあれば、相手に投げずにそれを返す", async () => {
        mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string } }) =>
            cmd.constructor.name === "GetCommand" ? cached(60_000) : {});
        const res = await invoke("福岡");
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).results).toEqual([{ label: "福岡市, 福岡県", lat: 33.59, lng: 130.4 }]);
        expect(fetchMock, "控えがあるのに相手に投げている").not.toHaveBeenCalled();
    });

    it("控えが無ければ投げて、結果を控える", async () => {
        fetchMock.mockResolvedValue(ok([{ lat: "33.59", lon: "130.40", display_name: "福岡市, 福岡県" }]));
        await invoke("福岡");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const puts = putCalls();
        expect(puts, "結果を控えていない").toHaveLength(1);
        expect((puts[0] as { input: { Item: Record<string, unknown> } }).input.Item).toMatchObject({
            id: "geocache#福岡",
            results: [{ label: "福岡市, 福岡県", lat: 33.59, lng: 130.4 }],
        });
    });

    it("古い控えは使わない（30日）", async () => {
        mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string } }) =>
            cmd.constructor.name === "GetCommand" ? cached(CACHE_TTL_MS + 1) : {});
        fetchMock.mockResolvedValue(ok([]));
        await invoke("福岡");
        expect(fetchMock, "古い控えを使っている").toHaveBeenCalledTimes(1);
    });

    // 表記ゆれで別の控えにしない（「福岡　」と「福岡」は同じ地名）
    it("空白の違いは同じ控えに寄せる", async () => {
        fetchMock.mockResolvedValue(ok([]));
        await invoke("  福岡　 ");
        expect((putCalls()[0] as { input: { Item: { id: string } } }).input.Item.id).toBe("geocache#福岡");
    });

    it("控えが読めなくても・書けなくても、探すことはできる", async () => {
        mockDdbSend.mockRejectedValue(new Error("AccessDenied"));
        fetchMock.mockResolvedValue(ok([{ lat: "33.59", lon: "130.40", display_name: "福岡市, 福岡県" }]));
        const res = await invoke("福岡");
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).results).toHaveLength(1);
    });
});

// 座標 → 地名（アップロード時の自動入力）。これまで**ブラウザから直接**
// Nominatim に撮影地の座標を送っていた。地名さがしと同じ理由でサーバー越しに
describe("geocodeReverse", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rev = (qs?: Record<string, string>): Promise<Result> => (geocodeReverse as any)({ queryStringParameters: qs });

    it("市区町村・県・国の順で地名を組む（番地は入れない）", () => {
        expect(placeNameFromReverse({ address: { city: "京都市", state: "京都府", country: "日本", road: "烏丸通" } })).toBe("京都市, 京都府, 日本");
        expect(placeNameFromReverse({ address: { village: "山中湖村", state: "山梨県", country: "日本" } })).toBe("山中湖村, 山梨県, 日本");
        expect(placeNameFromReverse({ display_name: "どこか" })).toBe("どこか");
        expect(placeNameFromReverse({})).toBeNull();
        expect(placeNameFromReverse(null)).toBeNull();
    });

    it("座標が読めなければ 400（外に投げない）", async () => {
        expect((await rev({ lat: "abc", lng: "1" })).statusCode).toBe(400);
        expect((await rev({ lat: "91", lng: "1" })).statusCode).toBe(400);
        expect((await rev()).statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("約1kmに丸めてから引き、市区町村レベル（zoom=10）で聞く", async () => {
        fetchMock.mockResolvedValue(ok({ address: { city: "京都市", state: "京都府", country: "日本" } }));
        const res = await rev({ lat: "35.011636", lng: "135.768029", locale: "ja" });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).place).toBe("京都市, 京都府, 日本");
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain("lat=35.01&lon=135.77");   // 小数2桁
        expect(url).toContain("zoom=10");
        expect(url).not.toContain("35.011636");           // 生の座標を送らない
        const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; signal: unknown };
        expect(init.headers["User-Agent"]).toMatch(/journey-photo/);
        expect(init.signal, "外向き通信に打ち切りが無い").toBeTruthy();
    });

    it("同じ座標は控えから返し、相手に投げない", async () => {
        mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string } }) =>
            cmd.constructor.name === "GetCommand"
                ? { Item: { id: "geocache#rev:ja:35.01,135.77", place: "京都市, 京都府, 日本", cachedAt: Date.now() - 1000 } }
                : {});
        const res = await rev({ lat: "35.014", lng: "135.766" });
        expect(JSON.parse(res.body).place).toBe("京都市, 京都府, 日本");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("「地名が無い」も控える（無い座標を毎回引き直さない）", async () => {
        fetchMock.mockResolvedValue(ok({}));
        await rev({ lat: "0", lng: "0" });
        const put = mockDdbSend.mock.calls.map((c) => c[0]).find((cmd) => cmd?.constructor?.name === "PutCommand") as { input: { Item: Record<string, unknown> } };
        expect(put.input.Item).toMatchObject({ id: "geocache#rev:ja:0,0", place: null });
    });

    it("相手が返らなければ 500 で畳む", async () => {
        fetchMock.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
        expect((await rev({ lat: "35", lng: "135" })).statusCode).toBe(500);
    });
});
