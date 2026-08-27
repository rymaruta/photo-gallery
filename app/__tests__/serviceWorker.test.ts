import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Service Worker は壊すと**戻ってきた人のサイトごと止まる**（過去に
// 「表示はされるが一切タップできない」を踏んでいる）。実物を読み込んで
// ハンドラを手で叩く。※テストは public/ に置かない——あそこはビルドで
// そのまま公開されるので、置くとテストファイルごと配信される。
//
// それまでは GET を一切キャッシュしないどころか起動のたびに Cache Storage を
// 全消ししていたので、ホーム画面に追加できて全画面で開くのに
// **機内モードではブラウザのエラー画面**になっていた。

type Handler = (event: unknown) => void;
type FakeCache = {
    store: Map<string, Response>;
    match: (req: Request | string, opts?: { ignoreSearch?: boolean }) => Promise<Response | undefined>;
    put: (req: Request | string, res: Response) => Promise<void>;
    add: (url: string) => Promise<void>;
};

const keyOf = (req: Request | string) => (typeof req === "string" ? req : req.url);
const pathOf = (k: string) => {
    try { return new URL(k, "https://journey-photo.com").pathname; } catch { return k; }
};

function makeCache(): FakeCache {
    const store = new Map<string, Response>();
    return {
        store,
        async match(req, opts) {
            const k = keyOf(req);
            if (store.has(k)) return store.get(k);
            for (const [sk, v] of store) {
                if (pathOf(sk) === pathOf(k)) return v;
                if (opts?.ignoreSearch && pathOf(sk).split("?")[0] === pathOf(k).split("?")[0]) return v;
            }
            return undefined;
        },
        async put(req, res) { store.set(keyOf(req), res); },
        async add(url) { store.set(url, new Response("precached", { status: 200 })); },
    };
}

let handlers: Record<string, Handler>;
let caches_: Map<string, FakeCache>;
let fetchMock: ReturnType<typeof vi.fn>;
let claimed: boolean;

function loadSw() {
    handlers = {};
    caches_ = new Map();
    claimed = false;
    fetchMock = vi.fn();

    const cachesApi = {
        open: async (name: string) => {
            if (!caches_.has(name)) caches_.set(name, makeCache());
            return caches_.get(name)!;
        },
        keys: async () => [...caches_.keys()],
        delete: async (name: string) => caches_.delete(name),
        match: async (req: Request | string, opts?: { ignoreSearch?: boolean }) => {
            for (const c of caches_.values()) {
                const hit = await c.match(req, opts);
                if (hit) return hit;
            }
            return undefined;
        },
    };
    const self_ = {
        addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
        skipWaiting: async () => undefined,
        clients: { claim: async () => { claimed = true; } },
        caches: cachesApi,
        location: { origin: "https://journey-photo.com" },
    };
    const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    new Function("self", "caches", "fetch", "indexedDB", "Response", "URL", "File", "console", src)(
        self_, cachesApi, fetchMock, {}, Response, URL, File, console,
    );
}

function makeEvent(request?: Request) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    return {
        request,
        waitUntil: (p: Promise<unknown>) => { waits.push(p); },
        respondWith: (p: Promise<Response>) => { responded = p; },
        settle: () => Promise.all(waits),
        get response() { return responded; },
    };
}

async function installed() {
    const e = makeEvent();
    handlers.install(e);
    await e.settle();
    return [...caches_.values()][0];
}

function navRequest(url: string) {
    const req = new Request(url, { method: "GET" });
    Object.defineProperty(req, "mode", { value: "navigate" });
    return req;
}

beforeEach(() => { loadSw(); });

describe("インストールと後片付け", () => {
    it("トップページを先に持っておく（オフラインの受け皿）", async () => {
        const cache = await installed();
        expect(await cache.match("/")).toBeTruthy();
    });

    // **全消しに戻すと、自分が入れたばかりの分まで毎回消えて 0点に戻る。**
    it("activate で消すのは他のバージョンだけ", async () => {
        await installed();
        caches_.set("journey-photo-v0", makeCache());
        caches_.set("someone-else", makeCache());

        const e = makeEvent();
        handlers.activate(e);
        await e.settle();

        const names = [...caches_.keys()];
        expect(names).toContain("journey-photo-v1");
        expect(names).not.toContain("journey-photo-v0");
        expect(names).not.toContain("someone-else");
        expect(claimed).toBe(true);
    });
});

describe("ページの取得", () => {
    it("オンラインではネットワークを優先する（古いシェルを配らない）", async () => {
        const cache = await installed();
        await cache.put("https://journey-photo.com/photo/p1", new Response("ふるい", { status: 200 }));
        fetchMock.mockResolvedValue(new Response("あたらしい", { status: 200 }));

        const e = makeEvent(navRequest("https://journey-photo.com/photo/p1"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("あたらしい");
    });

    it("落ちたら同じページの控えを出す（機内モードで開ける）", async () => {
        const cache = await installed();
        await cache.put("https://journey-photo.com/photo/p1", new Response("まえに見たページ", { status: 200 }));
        fetchMock.mockRejectedValue(new TypeError("offline"));

        const e = makeEvent(navRequest("https://journey-photo.com/photo/p1"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("まえに見たページ");
    });

    it("控えが無ければトップページを出す（エラー画面にしない）", async () => {
        await installed();
        fetchMock.mockRejectedValue(new TypeError("offline"));

        const e = makeEvent(navRequest("https://journey-photo.com/photo/hajimete"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("precached");
    });
});

describe("触らないもの", () => {
    it.each([
        ["GET 以外", new Request("https://journey-photo.com/x", { method: "PUT" })],
        ["別オリジン（画像CDN・API）", new Request("https://d1s3.cloudfront.net/uploads/a.jpg")],
        // **同じ形のパスでも別オリジンなら触らない。** ここを
        // `/uploads/a.jpg` だけで測っていたときは、同一オリジンの判定を
        // 外しても**どの分岐にも入らないので素通りした**（変異が空振り）。
        ["別オリジンのハッシュ名資産", new Request("https://other.example/_next/static/chunks/x.js")],
        ["自分自身", new Request("https://journey-photo.com/sw.js")],
        ["ハッシュ名でない同一オリジンの GET", new Request("https://journey-photo.com/data/photos.json")],
    ])("%s は素通しする", (_name, req) => {
        const e = makeEvent(req);
        handlers.fetch(e);
        expect(e.response).toBeUndefined();
    });
});

describe("ハッシュ名の資産", () => {
    it("控えがあれば使う（内容が変われば別のURLになるので古くならない）", async () => {
        const cache = await installed();
        await cache.put("https://journey-photo.com/_next/static/chunks/a.js", new Response("cached", { status: 200 }));

        const e = makeEvent(new Request("https://journey-photo.com/_next/static/chunks/a.js"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("cached");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("無ければ取りに行って控える", async () => {
        const cache = await installed();
        fetchMock.mockResolvedValue(new Response("fresh", { status: 200 }));

        const e = makeEvent(new Request("https://journey-photo.com/_next/static/chunks/b.js"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("fresh");

        await new Promise((r) => setTimeout(r, 10));
        expect(await cache.match("https://journey-photo.com/_next/static/chunks/b.js")).toBeTruthy();
    });
});
