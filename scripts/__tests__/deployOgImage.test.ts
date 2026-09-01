import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// **OGP 画像は「消えうる URL」を指している。**
//
// 以前ここは `/images/og-image.jpg` という**存在しないファイル**を指しており、
// 16ページがそれを OGP 画像として出していた（トップを SNS に貼っても画像が
// 出ない）。誰も見ていない場所だったので長く気づけなかった。
//
// いまはビルド時に「一番新しい公開写真」を焼き込むので、**利用者がその写真を
// 削除すると次のサイトビルドまで壊れたまま**になる（削除は S3 の実体も消し、
// 定期ビルドは止めてある）。デプロイのたびに1本 HEAD を投げておけば、
// 少なくとも次のデプロイで気づける。配信チェックと同じくアドバイザリで、
// **デプロイは止めない**。

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyOgImage } = require("../deploy-static-site.js") as {
    verifyOgImage: (opts?: {
        html?: string;
        fetchImpl?: (url: string, init?: { method?: string }) => Promise<{ status: number; headers: { get: (k: string) => string | null } }>;
    }) => Promise<string>;
};

const res = (status: number, ct: string | null) => ({
    status, headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? ct : null) },
});

const html = (url: string) => `<html><head><meta property="og:image" content="${url}"/></head></html>`;

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("デプロイ後の og:image チェック", () => {
    it("画像が取れれば ok", async () => {
        const out = await verifyOgImage({
            html: html("https://cdn/photo.jpg"),
            fetchImpl: async () => res(200, "image/jpeg"),
        });
        expect(out).toBe("ok");
    });

    it("404 なら broken（元の写真が消されたとき）", async () => {
        const warn = vi.spyOn(console, "warn");
        const out = await verifyOgImage({
            html: html("https://cdn/deleted.jpg"),
            fetchImpl: async () => res(404, "text/html"),
        });
        expect(out).toBe("broken");
        expect(warn.mock.calls.flat().join(" ")).toContain("og:image が取れません");
    });

    // 200 でも画像でなければ駄目（403 のエラーページが 200 で返る配信がある）
    it("画像でない Content-Type は broken", async () => {
        const out = await verifyOgImage({
            html: html("https://cdn/x.jpg"),
            fetchImpl: async () => res(200, "text/html"),
        });
        expect(out).toBe("broken");
    });

    it("HEAD が塞がれていたら GET で見直す", async () => {
        const calls: string[] = [];
        const out = await verifyOgImage({
            html: html("https://cdn/x.jpg"),
            fetchImpl: async (_u, init) => {
                calls.push(init?.method ?? "GET");
                return calls.length === 1 ? res(405, "text/html") : res(200, "image/webp");
            },
        });
        expect(calls).toEqual(["HEAD", "GET"]);
        expect(out).toBe("ok");
    });

    it("og:image が無ければ missing（黙らない）", async () => {
        const out = await verifyOgImage({ html: "<html><head></head></html>", fetchImpl: async () => res(200, "image/jpeg") });
        expect(out).toBe("missing");
    });

    // 通信そのものが失敗してもデプロイは止めない（投げない）
    it("取得に失敗しても例外にしない", async () => {
        const out = await verifyOgImage({
            html: html("https://cdn/x.jpg"),
            fetchImpl: async () => { throw new Error("network down"); },
        });
        expect(out).toBe("error");
    });
});
