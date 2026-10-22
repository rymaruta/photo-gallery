import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/**
 * 正規の URL へ寄せる 301（`scripts/edge/canonical-redirect.js`・2026-10-22）。
 *
 * 既存の viewer-request のエッジ関数の頭で呼ぶ。**外れたら全ページが壊れる場所**なので、
 * 「寄せるもの」と同じだけ「触らないもの」（静的ファイル・画像・API・`/en`・本物の .html）を縛る。
 */
type Req = { host?: string; uri: string; querystring?: string; method?: string };
const require_ = createRequire(import.meta.url);
const SRC_PATH = join(__dirname, "../edge/canonical-redirect.js");
const m = require_(SRC_PATH) as {
    canonicalPath: (p: string) => string;
    canonicalRedirectTarget: (r: Req) => string | null;
    lambdaEdgeRedirect: (e: unknown) => null | { status: string; headers: Record<string, Array<{ key: string; value: string }>> };
    withCanonicalRedirect: (h: (...a: never[]) => unknown) => (...a: unknown[]) => unknown;
    cloudFrontFunctionRedirect: (e: unknown) => null | { statusCode: number; headers: Record<string, { value: string }> };
    cfFunctionQuery: (q: unknown) => string;
};
const target = (uri: string, over: Partial<Req> = {}) => m.canonicalRedirectTarget({ host: "journey-photo.com", uri, ...over });

describe("寄せるもの", () => {
    it.each([
        ["/spots/abukumado/", "/spots/abukumado"],
        ["/spots/abukumado//", "/spots/abukumado"],
        ["/spots/abukumado.html", "/spots/abukumado"],
        ["/spots/abukumado.HTML", "/spots/abukumado"],
        ["/spots/abukumado.html/", "/spots/abukumado"],
        ["/index.html", "/"],
        ["/spots/index.html", "/spots"],
        ["/spots.html", "/spots"],
        ["/location/%E3%83%91%E3%83%AA/", "/location/%E3%83%91%E3%83%AA"],
        ["/location/%E3%83%91%E3%83%AA.html", "/location/%E3%83%91%E3%83%AA"],
        ["/photo/abc123/", "/photo/abc123"],
        ["/tag/finland/", "/tag/finland"],
        ["//", "/"],
    ])("%s → %s", (from, to) => {
        expect(target(from)).toBe(to);
    });

    it("クエリは残す", () => {
        expect(target("/spots/x/", { querystring: "photo=abc&utm_source=x" })).toBe("/spots/x?photo=abc&utm_source=x");
    });

    it("www は apex の絶対 URL へ（パス・クエリはそのまま、パスの規則も一度に掛ける＝2回跳ばない）", () => {
        expect(target("/", { host: "www.journey-photo.com" })).toBe("https://journey-photo.com/");
        expect(target("/photo/abc", { host: "www.journey-photo.com", querystring: "a=1" })).toBe("https://journey-photo.com/photo/abc?a=1");
        expect(target("/spots/x/", { host: "WWW.Journey-Photo.com" })).toBe("https://journey-photo.com/spots/x");
        expect(target("/spots/x.html", { host: "www.journey-photo.com:443" })).toBe("https://journey-photo.com/spots/x");
        expect(target("/spots/x", { host: "www.journey-photo.com." })).toBe("https://journey-photo.com/spots/x");
    });

    it("www は静的ファイル・画像・API・/en もパスを変えずに apex へ", () => {
        for (const uri of ["/_next/static/chunks/a.js", "/uploads/u/1.jpg", "/api/photos", "/en", "/en/", "/sw.js", "/offline.html", "/feed.xml"]) {
            expect(target(uri, { host: "www.journey-photo.com" }), uri).toBe(`https://journey-photo.com${uri}`);
        }
    });

    it("HEAD も寄せる", () => {
        expect(target("/a/", { method: "HEAD" })).toBe("/a");
    });
});

describe("触らないもの（既存の振る舞い）", () => {
    it.each([
        "/",
        "/spots/abukumado",
        "/location/%E3%83%91%E3%83%AA",
        "/photo/abc123",
        "/_next/static/chunks/main-abc.js",
        "/_next/static/css/a.css",
        "/_next/static/media/font.woff2",
        "/_next/static/chunks/",
        "/_not-found.html",
        "/uploads/photos/a.jpg",
        "/uploads/photos/",
        "/profiles/uid/avatar.jpg",
        "/api/photos",
        "/api/photos/",
        "/images/spots/thumb/x.webp",
        "/samples/a.jpg",
        "/favicon.ico",
        "/manifest.webmanifest",
        "/sw.js",
        "/robots.txt",
        "/sitemap.xml",
        "/feed.xml",
        "/spots/abukumado.txt",
        "/__next._full.txt",
        "/offline.html",
        "/404.html",
        "/google1234abcd.html",
        "/en",
        "/en/",
        "/en/spots/x/",
        "/en/spots/x.html",
    ])("%s は寄せない", (uri) => {
        expect(target(uri)).toBeNull();
    });

    it("GET / HEAD 以外は触らない（301 で POST を GET に化けさせない）", () => {
        for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
            expect(target("/a/", { method }), method).toBeNull();
            expect(target("/a", { method, host: "www.journey-photo.com" }), method).toBeNull();
        }
    });

    it("ほかの host（CloudFront の既定ドメイン・staging）は www の寄せをしない（パスの規則だけ・相対の行き先）", () => {
        expect(target("/a", { host: "d1s3dwwzgxf5ni.cloudfront.net" })).toBeNull();
        expect(target("/a/", { host: "d15fn3rcaiymu9.cloudfront.net" })).toBe("/a");
        expect(target("/a/", { host: "" })).toBe("/a");
        expect(target("/a", { host: "evil.example" })).toBeNull();
    });

    it("uri が / で始まらない・空は触らない", () => {
        expect(target("")).toBeNull();
        expect(target("a/")).toBeNull();
        expect(m.canonicalRedirectTarget({ uri: undefined as unknown as string })).toBeNull();
    });
});

describe("安全（開いたリダイレクトにしない）", () => {
    it("先頭の // は1本に畳む（スキーム相対の行き先を返さない）", () => {
        expect(target("//evil.example/")).toBe("/evil.example");
        expect(target("///evil.example/x/")).toBe("/evil.example/x");
        expect(target("//evil.example/a.html")).toBe("/evil.example/a");
    });

    it("逆スラッシュ・制御文字を含む uri は触らない", () => {
        expect(target("/\\evil.example/")).toBeNull();
        expect(target("/a\\b/")).toBeNull();
        expect(target("/a\r\nLocation: x/")).toBeNull();
        expect(target("/a\u0000/")).toBeNull();
    });

    it("行き先は必ず `/` 1本か `https://journey-photo.com/` で始まる（大量の形で）", () => {
        const pieces = ["", "/", "//", "a", "a/", ".html", "index.html", "en", "_next", "%2F", "x.y", ".."];
        for (const host of ["journey-photo.com", "www.journey-photo.com", "", "evil.example"]) {
            for (const a of pieces) for (const b of pieces) for (const c of pieces) {
                const uri = `/${a}${b}${c}`;
                const t = target(uri, { host });
                if (t === null) continue;
                expect(t, `${host} ${uri}`).toMatch(/^(\/(?!\/)|https:\/\/journey-photo\.com\/)/);
                // 1回で収まる（行き先をもう一度通すと、apex では寄せない＝ループしない）
                const again = t.startsWith("https://") ? t.slice("https://journey-photo.com".length) : t;
                expect(target(again, { host: "journey-photo.com" }), `${host} ${uri} → ${t}`).toBeNull();
            }
        }
    });
});

describe("Lambda@Edge の形", () => {
    const event = (uri: string, host = "journey-photo.com", querystring = "", method = "GET") => ({
        Records: [{ cf: { request: { uri, querystring, method, headers: { host: [{ key: "Host", value: host }] } } } }],
    });

    it("301 と Location・Cache-Control を返す", () => {
        const r = m.lambdaEdgeRedirect(event("/spots/x/", "www.journey-photo.com", "a=1"))!;
        expect(r.status).toBe("301");
        expect(r.headers.location).toEqual([{ key: "Location", value: "https://journey-photo.com/spots/x?a=1" }]);
        expect(r.headers["cache-control"][0].value).toMatch(/max-age=\d+/);
    });

    it("寄せないときは null・壊れた event でも投げない", () => {
        expect(m.lambdaEdgeRedirect(event("/spots/x"))).toBeNull();
        expect(m.lambdaEdgeRedirect({})).toBeNull();
        expect(m.lambdaEdgeRedirect(undefined)).toBeNull();
        expect(m.lambdaEdgeRedirect({ Records: [{ cf: { request: { uri: "/a/", headers: {} } } }] })).not.toBeNull();
    });

    it("包んだ handler: 301 のときは元を呼ばない・それ以外は元に event をそのまま渡す（async 形）", async () => {
        const inner = vi.fn(async (e: unknown) => ({ passed: e }));
        const h = m.withCanonicalRedirect(inner);
        const r = await h(event("/a/"), {}) as { status: string };
        expect(r.status).toBe("301");
        expect(inner).not.toHaveBeenCalled();
        const ev = event("/a");
        expect(await h(ev, {})).toEqual({ passed: ev });
        expect(inner).toHaveBeenCalledTimes(1);
    });

    it("包んだ handler: callback 形でも動く", () => {
        const inner = vi.fn((_e: unknown, _c: unknown, cb: (err: null, r: unknown) => void) => cb(null, "inner"));
        const h = m.withCanonicalRedirect(inner);
        const cb = vi.fn();
        h(event("/a.html"), {}, cb);
        expect(cb).toHaveBeenCalledWith(null, expect.objectContaining({ status: "301" }));
        expect(inner).not.toHaveBeenCalled();
        h(event("/a"), {}, cb);
        expect(cb).toHaveBeenLastCalledWith(null, "inner");
    });
});

describe("CloudFront Functions の形", () => {
    const event = (uri: string, host = "journey-photo.com", querystring: Record<string, unknown> = {}, method = "GET") => ({
        request: { uri, method, querystring, headers: { host: { value: host } } },
    });

    it("301 と location を返す。querystring のオブジェクトを戻す（複数値・値なし）", () => {
        const r = m.cloudFrontFunctionRedirect(event("/a/", "www.journey-photo.com", {
            photo: { value: "abc" }, t: { value: "1", multiValue: [{ value: "1" }, { value: "2" }] }, flag: { value: "" },
        }))!;
        expect(r.statusCode).toBe(301);
        expect(r.headers.location.value).toBe("https://journey-photo.com/a?photo=abc&t=1&t=2&flag");
    });

    it("寄せないときは null", () => {
        expect(m.cloudFrontFunctionRedirect(event("/a"))).toBeNull();
        expect(m.cloudFrontFunctionRedirect(event("/_next/static/a.js", "journey-photo.com"))).toBeNull();
        expect(m.cloudFrontFunctionRedirect({})).toBeNull();
    });

    it("CloudFront Functions の実行環境に無いもの（require・import・async・class）を使っていない。素の vm で読める", () => {
        const src = readFileSync(SRC_PATH, "utf8");
        const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
        expect(code).not.toMatch(/\brequire\(|\bimport\b|\basync\b|\bclass\b|=>/);
        const ctx: Record<string, unknown> = {};
        vm.runInNewContext(`${src}\n;this.out = cloudFrontFunctionRedirect({ request: { uri: "/a/", method: "GET", querystring: {}, headers: { host: { value: "www.journey-photo.com" } } } });`, ctx);
        expect((ctx.out as { headers: { location: { value: string } } }).headers.location.value).toBe("https://journey-photo.com/a");
    });
});

describe("今のビルドの出力と食い違わない", () => {
    it("public/ に置いた本物の .html は寄せない", () => {
        const htmls = readdirSync(join(__dirname, "../../public")).filter((f) => f.endsWith(".html"));
        expect(htmls.length).toBeGreaterThan(0);
        for (const f of htmls) expect(target(`/${f}`), f).toBeNull();
    });
});
