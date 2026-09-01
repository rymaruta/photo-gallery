import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { musicSearch, mapItunesResults, FETCH_TIMEOUT_MS } from "../musicSearch";

// **Lambda から出ていく通信のうち、ここだけタイムアウトが無かった。**
//
// この関数の Lambda タイムアウトは6秒（`serverless.yml` に個別指定が無く
// provider にも無いので serverless の既定。生成された CloudFormation の
// `Timeout: 6` で確認）。iTunes が応答を返さないと、その6秒ぶん枠を握る。
//
// 枠は**アカウント全体で 10 しかない**（`lambda:GetAccountSettings` の実測。
// 総枠10・未予約10）。10本詰まると削除・退会・アップロードまで巻き添えで
// スロットルされる。ファイル冒頭のコメントはこの危険を名指しし、対策として
// `reservedConcurrency` を挙げているが、**総枠10では1つも予約できない**
// （予約を入れた本番デプロイが UPDATE_FAILED で巻き戻ったのが同じ日）。
// 挙げてある対策が使えないので、握る時間の方を短くする。
//
// `rebuild.ts` は GitHub を叩くときに既に `AbortSignal.timeout` を使っている。
// **同じリポジトリに正しい形があるのに、ここだけ持っていなかった。**

const ev = (q?: string) => ({ queryStringParameters: q === undefined ? undefined : { q } }) as never;
const ctx = {} as never;
const cb = (() => { }) as never;
const call = (q?: string) => musicSearch(ev(q), ctx, cb) as Promise<{ statusCode: number; body: string }>;

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("外向き通信に打ち切りがある", () => {
    it("fetch に AbortSignal を渡している", async () => {
        const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true, json: async () => ({ results: [] }),
        } as unknown as Response);

        await call("yoasobi");

        expect(spy).toHaveBeenCalledTimes(1);
        const init = spy.mock.calls[0][1] as RequestInit | undefined;
        expect(init?.signal, "signal が渡っていない＝応答が来ないと6秒枠を握る").toBeInstanceOf(AbortSignal);
    });

    // **Lambda のタイムアウトより十分手前で切れること。** 同じか長いと、
    // 打ち切りが効く前に Lambda ごと落ちる——catch が走らないので
    // ログも残らず、「iTunes が遅い」のか「落ちている」のか永久に分からない。
    //
    // 秒数は `serverless.yml` から読む。**両方に書いた数字は必ずずれる**ので、
    // 実物を見て突き合わせる（fake timer では確かめられない——
    // `AbortSignal.timeout` は Node の内部タイマーを使うので、
    // vitest が差し替える `setTimeout` を通らない。実際に試して確認した）。
    it("打ち切りは Lambda のタイムアウトより十分手前", () => {
        const yml = readFileSync(join(__dirname, "..", "..", "serverless.yml"), "utf8");
        const block = /^ {2}musicSearch:$([\s\S]*?)(?=^ {2}\w+:$)/m.exec(yml);
        expect(block, "musicSearch のブロックが見つからない").not.toBeNull();
        const t = /^ {4}timeout:\s*(\d+)\s*$/m.exec(block![1].replace(/^\s*#.*$/gm, ""));
        expect(t, "musicSearch に timeout が明示されていない").not.toBeNull();

        const lambdaMs = Number(t![1]) * 1000;
        expect(FETCH_TIMEOUT_MS).toBeLessThan(lambdaMs);
        // JSON の読み取りと整形のぶんを残す。ぎりぎりだと打ち切れても返せない
        expect(lambdaMs - FETCH_TIMEOUT_MS, "残り時間が短すぎる").toBeGreaterThanOrEqual(2000);
    });

    it("打ち切られても投げずに 500 を返す（ハングしない）", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(
            Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }),
        );
        const res = await call("yoasobi");
        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res.body).error).toBe("検索に失敗しました");
    });

    // 打ち切りと「iTunes が落ちている」をログで区別する。
    // 画面の文言は変えない（利用者にはどちらも「検索に失敗した」）
    it("打ち切りは別のログに出す", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => { });
        vi.spyOn(globalThis, "fetch").mockRejectedValue(
            Object.assign(new Error("aborted"), { name: "TimeoutError" }),
        );
        await call("yoasobi");
        expect(String(err.mock.calls[0][0])).toMatch(/timeout/i);
    });

    it("普通の失敗は打ち切り扱いにしない", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => { });
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
        await call("yoasobi");
        expect(String(err.mock.calls[0][0])).not.toMatch(/timeout/i);
    });
});

describe("正常系（打ち切りを足しても壊れていない）", () => {
    it("結果を整形して返す", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [{
                    trackId: 1, trackName: "夜に駆ける", artistName: "YOASOBI",
                    artworkUrl100: "https://x/100x100bb.jpg",
                    previewUrl: "https://x/p.m4a", trackViewUrl: "https://x/t",
                }],
            }),
        } as unknown as Response);

        const res = await call("yoasobi");
        expect(res.statusCode).toBe(200);
        const { results } = JSON.parse(res.body);
        expect(results).toEqual([{
            id: "1", title: "夜に駆ける", artist: "YOASOBI",
            artwork: "https://x/300x300bb.jpg", previewUrl: "https://x/p.m4a", trackUrl: "https://x/t",
        }]);
    });

    it("検索語が無ければ 400（外向き通信もしない）", async () => {
        const spy = vi.spyOn(globalThis, "fetch");
        const res = await call("   ");
        expect(res.statusCode).toBe(400);
        expect(spy).not.toHaveBeenCalled();
    });

    it("iTunes が 5xx なら 502", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
        expect((await call("yoasobi")).statusCode).toBe(502);
    });

    // 長い検索語をそのまま投げない（外向き通信を長引かせる側の入口）
    it("検索語は50文字で切る", async () => {
        const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true, json: async () => ({ results: [] }),
        } as unknown as Response);
        await call("あ".repeat(200));
        const url = String(spy.mock.calls[0][0]);
        expect(decodeURIComponent(url).match(/term=(あ+)/)![1].length).toBe(50);
    });

    it("previewUrl の無い曲は落とす", () => {
        expect(mapItunesResults({ results: [{ trackId: 1, trackName: "a", artistName: "b" }] })).toEqual([]);
    });
});
