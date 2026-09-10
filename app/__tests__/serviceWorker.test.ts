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
    keys: () => Promise<Request[]>;
    delete: (req: Request | string) => Promise<boolean>;
};

/** `cache.add()` が取りに行く先。既定は 200 を返す */
let fetchForAdd: (url: string) => Promise<Response> =
    async () => new Response("precached", { status: 200 });

/**
 * 本物の Cache API に寄せた偽物。
 *
 * **緩く作ると変異が素通りする。** 最初は pathname だけで一致させていたので、
 * クエリもオリジンも無視され、`ignoreSearch` を外しても・保存キーを変えても
 * テストが通ってしまった（レビューが6つの変異の生存を実測）。本物の規則:
 *   - キーは**絶対URL**で完全一致（クエリも含む）
 *   - `ignoreSearch` を指定したときだけクエリを落として比べる
 *   - `keys()` は**挿入順**（追い出しの順序がこれに依存する）
 */
const keyOf = (req: Request | string) =>
    new URL(typeof req === "string" ? req : req.url, "https://journey-photo.com").toString();
const dropSearch = (u: string) => { const x = new URL(u); x.search = ""; return x.toString(); };

function makeCache(): FakeCache {
    const store = new Map<string, Response>();
    return {
        store,
        async match(req, opts) {
            const k = keyOf(req);
            if (store.has(k)) return store.get(k);
            if (opts?.ignoreSearch) {
                for (const [sk, v] of store) if (dropSearch(sk) === dropSearch(k)) return v;
            }
            return undefined;
        },
        // **本物は中身を読み切る。** 使用済み（disturbed）の Response は
        // TypeError で断り、読んだバイト列を持つ**別の Response** を返す。
        // ここを「そのまま Map に入れるだけ」にしていたので、
        //   - `res.clone()` を落とす変異（実機では put が `<img>` に返す本体を
        //     食って**写真が表示されなくなる**）
        //   - 容量エラーのあと同じ Response で put し直す誤り
        // のどちらもテストから無害に見えていた。
        async put(req, res) {
            if (res.bodyUsed) throw new TypeError("Response body is already used");
            const buf = res.body ? await res.arrayBuffer() : null;
            const stored = new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
            // opaque は Response では作れないので型だけ持ち回す
            Object.defineProperty(stored, "type", { value: res.type });
            store.set(keyOf(req), stored);
        },
        async add(url) {
            // 本物は fetch して put する。ここでは呼び出し側が用意した応答を使う
            const res = await fetchForAdd(keyOf(url));
            await this.put(url, res);
        },
        // **本物は Request を返す**（文字列ではない）。ここを文字列にして
        // いたので、追い出しの実装が `k.url` を読むようになっても
        // テストからは気づけなかった
        async keys() { return [...store.keys()].map((k) => new Request(k)); },
        async delete(req) { return store.delete(keyOf(req)); },
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
        // **`cacheName` を無視してはいけない。** 本物は指定された入れ物しか
        // 見ない。ここを全キャッシュ横断にしていたので、「写真を読む先を
        // ページの入れ物に変える」変異（実機では常にミス＝機内モードで写真が
        // 1枚も出ない）が31件緑のまま生き残っていた。
        match: async (req: Request | string, opts?: { ignoreSearch?: boolean; cacheName?: string }) => {
            const targets = opts?.cacheName
                ? (caches_.has(opts.cacheName) ? [caches_.get(opts.cacheName)!] : [])
                : [...caches_.values()];
            for (const c of targets) {
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

beforeEach(() => {
    fetchForAdd = async () => new Response("precached", { status: 200 });
    loadSw();
});

describe("インストールと後片付け", () => {
    // 受け皿は **JS を要求しないページ**にすること。`/` の HTML は必ず
    // /_next/static のチャンクを要求し、それが無いと水和できず、
    // 水和ウォッチドッグが Cache Storage を全消しして自壊する。
    it("JS 非依存のオフラインページを先に持っておく", async () => {
        const cache = await installed();
        expect(await cache.match("https://journey-photo.com/offline.html")).toBeTruthy();
        // `/` の HTML は受け皿にしない
        expect(await cache.match("https://journey-photo.com/")).toBeUndefined();
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

    // **控えは実装に書かせる。** 手ずから cache.put で仕込むと、
    // 「成功した応答を控える」という**この差分の目的そのもの**を一度も
    // 通らない（レビューが「控えを書く処理を丸ごと消しても12本とも通る」と実測）。
    it("一度開いたページは、落ちたときに出る（機内モードで開ける）", async () => {
        await installed();
        fetchMock.mockResolvedValue(new Response("まえに見たページ", { status: 200 }));
        const first = makeEvent(navRequest("https://journey-photo.com/photo/p1"));
        handlers.fetch(first);
        await first.response;
        await new Promise((r) => setTimeout(r, 10));

        fetchMock.mockRejectedValue(new TypeError("offline"));
        const e = makeEvent(navRequest("https://journey-photo.com/photo/p1"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("まえに見たページ");
    });

    // Cache API は Cache-Control を見ない。寿命が無いと、削除した写真・
    // 非公開にした写真のページが、それを見たことのある端末に残り続ける
    // （消える経路が「本人がその URL を再訪してオンラインで成功する」だけ）。
    it("古すぎる控えは出さない（消したはずのページを出さない）", async () => {
        const cache = await installed();
        const old = new Response("ふるいページ", {
            status: 200,
            headers: { "x-sw-cached-at": String(Date.now() - 48 * 60 * 60 * 1000) },
        });
        await cache.put("https://journey-photo.com/photo/p1", old);
        fetchMock.mockRejectedValue(new TypeError("offline"));

        const e = makeEvent(navRequest("https://journey-photo.com/photo/p1"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("precached");
    });

    // **端末の時計を巻き戻すと、控えが永久に「新しい」になっていた。**
    // `Date.now() - at < 24時間` は、`at` が未来だと差が負になって必ず真。
    // 実測: 1日戻せば実時間25時間後でも、30日戻せば10日後でも出た。
    // 上の「消したはずのページを出さない」が、巻き戻した日数ぶん効かなくなる
    it("控えの時刻が未来（時計を巻き戻した）なら出さない", async () => {
        const cache = await installed();
        const future = new Response("巻き戻した端末のページ", {
            status: 200,
            headers: { "x-sw-cached-at": String(Date.now() + 24 * 60 * 60 * 1000) },
        });
        await cache.put("https://journey-photo.com/photo/p1", future);
        fetchMock.mockRejectedValue(new TypeError("offline"));

        const e = makeEvent(navRequest("https://journey-photo.com/photo/p1"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("precached");
    });

    // `?utm_source=` `?fbclid=` が付いた検索・SNS 流入は、同じページなのに
    // 別エントリになって際限なく増える。静的書き出しでは同じ HTML なので分けない。
    it("クエリ違いは同じ控えにまとめる", async () => {
        const cache = await installed();
        fetchMock.mockResolvedValue(new Response("ページ", { status: 200 }));
        for (const q of ["", "?utm_source=x", "?fbclid=y"]) {
            const e = makeEvent(navRequest(`https://journey-photo.com/photo/p1${q}`));
            handlers.fetch(e);
            await e.response;
        }
        await new Promise((r) => setTimeout(r, 10));

        const pages = (await cache.keys()).map((k) => k.url).filter((u) => u.includes("/photo/p1"));
        expect(pages).toEqual(["https://journey-photo.com/photo/p1"]);
    });

    it.each([
        ["404", new Response("nope", { status: 404 })],
        ["503", new Response("down", { status: 503 })],
    ])("%s は控えない（エラーを控えとして出さない）", async (_n, res) => {
        const cache = await installed();
        fetchMock.mockResolvedValue(res);
        const e = makeEvent(navRequest("https://journey-photo.com/photo/p9"));
        handlers.fetch(e);
        await e.response;
        await new Promise((r) => setTimeout(r, 10));

        expect(await cache.match("https://journey-photo.com/photo/p9")).toBeUndefined();
    });

    it("控えが無ければオフラインページを出す（エラー画面にしない）", async () => {
        await installed();
        fetchMock.mockRejectedValue(new TypeError("offline"));

        const e = makeEvent(navRequest("https://journey-photo.com/photo/hajimete"));
        handlers.fetch(e);
        expect(await (await e.response!).text()).toBe("precached");
    });
});

describe("触らないもの", () => {
    it.each([
        // **扱われうる形の URL で試す。** `/x` への PUT だと、GET 判定を
        // 外しても navigate 判定にも `_next/static` 判定にも入らないので
        // 結果が同じ＝変異が素通りする（実測）。ハッシュ名資産への PUT なら、
        // GET 判定だけが止めている形になる。
        ["GET 以外", new Request("https://journey-photo.com/_next/static/chunks/x.js", { method: "PUT" })],
        ["別オリジン（画像CDN・API）", new Request("https://d1s3.cloudfront.net/uploads/a.jpg")],
        // **同じ形のパスでも別オリジンなら触らない。** ここを
        // `/uploads/a.jpg` だけで測っていたときは、同一オリジンの判定を
        // 外しても**どの分岐にも入らないので素通りした**（変異が空振り）。
        ["別オリジンのハッシュ名資産", new Request("https://other.example/_next/static/chunks/x.js")],
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


describe("控えの上限", () => {
    /** 種類ごとに数える（この控えはページ・資産・受け皿が同居している） */
    const countKinds = async (cache: FakeCache) => {
        const urls = (await cache.keys()).map((k) => new URL(k.url).pathname);
        return {
            pages: urls.filter((u) => !u.startsWith("/_next/static/") && u !== "/offline.html" && u !== "/manifest.webmanifest"),
            assets: urls.filter((u) => u.startsWith("/_next/static/")),
            precache: urls.filter((u) => u === "/offline.html" || u === "/manifest.webmanifest"),
        };
    };

    const openPages = async (n: number, from = 0) => {
        for (let i = from; i < from + n; i++) {
            const e = makeEvent(navRequest(`https://journey-photo.com/photo/p${i}`));
            handlers.fetch(e);
            await e.response;
            await new Promise((r) => setTimeout(r, 0));
        }
    };

    const getAssets = async (n: number, from = 0) => {
        for (let i = from; i < from + n; i++) {
            const e = makeEvent(new Request(`https://journey-photo.com/_next/static/chunks/c${i}.js`));
            handlers.fetch(e);
            await e.response;
            await new Promise((r) => setTimeout(r, 0));
        }
    };

    it("増えすぎたら古い順に捨てる（端末の容量を食いつぶさない）", async () => {
        const cache = await installed();
        fetchMock.mockResolvedValue(new Response("ページ", { status: 200 }));
        await openPages(65);

        const { pages } = await countKinds(cache);
        expect(pages.length).toBeLessThanOrEqual(60);
        // 捨てるのは古い方から
        const urls = (await cache.keys()).map((k) => k.url);
        expect(urls.some((u) => u.endsWith("/photo/p64"))).toBe(true);
        expect(urls.some((u) => u.endsWith("/photo/p0"))).toBe(false);
    });

    // **ここが壊れていた。** 全件を1つの上限で数えていたので、ページを60件
    // 見るより先に上限へ達し、古い順＝受け皿と資産から消えていた。
    // 資産が消えると、オフラインで開いても JS の揃わない HTML になる
    // ——「一度見たページが開く」という目的そのものが崩れる。
    it("ページを増やしても、資産と受け皿は巻き添えで消えない", async () => {
        const cache = await installed();
        fetchMock.mockResolvedValue(new Response("chunk", { status: 200 }));
        await getAssets(10);
        fetchMock.mockResolvedValue(new Response("ページ", { status: 200 }));
        await openPages(65);

        const { pages, assets, precache } = await countKinds(cache);
        expect(pages.length).toBeLessThanOrEqual(60);
        expect(assets.length, "資産がページの追い出しに巻き込まれた").toBe(10);
        // manifest は precache でしか入らない＝一度消えると二度と戻らない
        expect(precache, "受け皿が消えた").toContain("/manifest.webmanifest");
        expect(precache).toContain("/offline.html");
    });

    it("資産にも上限がある（ページとは別枠で数える）", async () => {
        const cache = await installed();
        fetchMock.mockResolvedValue(new Response("chunk", { status: 200 }));
        await getAssets(155);

        const { assets } = await countKinds(cache);
        // **上からだけでなく、値そのものを挟む。**
        // `toBeLessThanOrEqual(150)` だけだと、上限を 20 に下げても緑になる
        // ——20 は「1ページ開くだけで自分のチャンクを追い出す」水準で、
        // オフラインの目的が崩れる。直したい方向の回帰を捕まえない形だった
        expect(assets.length, "資産の上限が変わった（下げると同じ版どうしで追い出し合う）").toBe(150);
        const urls = (await cache.keys()).map((k) => k.url);
        expect(urls.some((u) => u.endsWith("/chunks/c154.js"))).toBe(true);
        expect(urls.some((u) => u.endsWith("/chunks/c0.js"))).toBe(false);
    });

    it("資産を増やしても、ページは巻き添えで消えない", async () => {
        const cache = await installed();
        fetchMock.mockResolvedValue(new Response("ページ", { status: 200 }));
        await openPages(5);
        fetchMock.mockResolvedValue(new Response("chunk", { status: 200 }));
        await getAssets(155);

        const { pages } = await countKinds(cache);
        expect(pages.length, "ページが資産の追い出しに巻き込まれた").toBe(5);
    });
});

// install は sw.js のバイトが変わるまで再実行されない。precache を一度
// 取り逃すと受け皿がゼロのままになるので、成功したページ取得のついでに埋める。
describe("受け皿の取り逃し", () => {
    it("install で取れなくても、次にページが開けたときに埋まる", async () => {
        fetchForAdd = async () => { throw new TypeError("offline"); };
        const cache = await installed();
        expect(await cache.match("https://journey-photo.com/offline.html")).toBeUndefined();

        fetchForAdd = async () => new Response("precached", { status: 200 });
        fetchMock.mockResolvedValue(new Response("ページ", { status: 200 }));
        const e = makeEvent(navRequest("https://journey-photo.com/photo/p1"));
        handlers.fetch(e);
        await e.response;
        await new Promise((r) => setTimeout(r, 10));

        expect(await cache.match("https://journey-photo.com/offline.html")).toBeTruthy();
    });
});

// **写真の控え（機内モードで写真が出る）。**
// それまでは「一度見たページが開く」までで、画像は1枚もキャッシュして
// いなかったので、機内モードでは枠だけが出ていた。
//
// 入れ物はページ・資産と**分ける**。同じにすると、写真を数十枚見ただけで
// 受け皿（offline.html）と `_next/static` を押し出し、「一度見たページが
// 開く」という元の目的が崩れる（この形の事故は既に一度踏んでいる）。

/** `<img>` からの要求（no-cors → 応答は opaque） */
function imgRequest(url: string) {
    const req = new Request(url, { method: "GET" });
    Object.defineProperty(req, "destination", { value: "image" });
    return req;
}
/** ブラウザが返す opaque 応答に寄せる */
const opaque = () => {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, "type", { value: "opaque" });
    return res;
};
const CDN = "https://d1s3dwwzgxf5ni.cloudfront.net";

describe("写真の控え", () => {
    it("画像CDN（別オリジン）の写真も控える", async () => {
        fetchMock.mockResolvedValue(opaque());
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(e);
        await e.response;
        await new Promise((r) => setTimeout(r, 0));

        const img = caches_.get("journey-photo-img-v1");
        expect(img, "写真用の入れ物が無い").toBeTruthy();
        expect([...img!.store.keys()]).toEqual([`${CDN}/uploads/u1/a.jpg`]);
        // **ページ・資産の入れ物には入れない**（押し出し事故を作らない）
        expect([...(caches_.get("journey-photo-v1")?.store.keys() ?? [])])
            .not.toContain(`${CDN}/uploads/u1/a.jpg`);
    });

    it("2回目はネットワークに行かない（機内モードで出る）", async () => {
        fetchMock.mockResolvedValue(opaque());
        const first = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(first);
        await first.response;
        await new Promise((r) => setTimeout(r, 0));

        fetchMock.mockRejectedValue(new TypeError("offline"));
        const second = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(second);
        await expect(second.response).resolves.toBeTruthy();
    });

    // **アバター・カバーは控えない。** `profiles/<uid>` は uuid ではなく
    // **固定キーで中身だけ差し替わる**ので、控えるとアイコンを変えても
    // 差し替えが届かない（サーバーもアップロード側も `no-store` を付けて
    // いる＝アプリが明示している防御を SW が上書きすることになる）。
    it("プロフィールの画像は控えない（差し替えが届かなくなるため）", async () => {
        fetchMock.mockResolvedValue(opaque());
        const e = makeEvent(imgRequest(`${CDN}/profiles/u1`));
        handlers.fetch(e);
        expect(e.response, "アイコンに手を出している").toBeUndefined();
    });

    // **読む先を間違えると、実機では機能が丸ごと死ぬ**（常にミス＝機内モードで
    // 写真が出ない）のに、偽の caches が全キャッシュを横断していたので
    // 見えなかった。ページの入れ物にだけ在る写真は、無いものとして扱う。
    it("ページの入れ物に同じURLが在っても、そこからは出さない", async () => {
        const page = makeCache();
        await page.put(`${CDN}/uploads/u1/a.jpg`, new Response("ページ側の写し", { status: 200 }));
        caches_.set("journey-photo-v1", page);

        fetchMock.mockRejectedValue(new TypeError("offline"));
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(e);
        await expect(e.response).rejects.toThrow();
    });

    // **控えるために本体を食ってはいけない。** 本物の `Cache.put` は中身を
    // 読み切るので、`res.clone()` を落とすと画面に返る応答が空になる
    // （＝写真が表示されない）
    it("控えても、画面に返す応答はそのまま読める", async () => {
        fetchMock.mockResolvedValue(new Response("photo-bytes", { status: 200 }));
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(e);
        const res = await e.response!;
        expect(await res.text()).toBe("photo-bytes");
    });

    // **容量で断られたときの経路。** ここは設計判断として一番丁寧に書いた
    // ところなのに、1行もテストが無かった。3つの誤りを同時に見る:
    //   - やり直さない
    //   - 半分に減らさない（減らさなければ次も断られる）
    //   - 1回目で使い切った Response をそのまま put し直す（必ず TypeError）
    it("容量で断られたら、半分捨ててやり直す", async () => {
        const img = makeCache();
        for (let i = 0; i < 80; i++) img.store.set(`${CDN}/uploads/u1/old${i}.jpg`, new Response("old"));
        const realPut = img.put.bind(img);
        img.put = async (req, res) => {
            // 本物と同じ順序: 使用済みなら読む前に断る → 中身を読み切る → 容量を見る
            if (res.bodyUsed) throw new TypeError("Response body is already used");
            if (res.body) await res.arrayBuffer();
            if (img.store.size > 40) throw new Error("QuotaExceededError");
            img.store.set(keyOf(req), new Response("stored"));
        };
        void realPut;
        caches_.set("journey-photo-img-v1", img);

        // opaque（body なし）ではなく**読める応答**で見る。staging は
        // 同一オリジン配信なのでこちらの形になり、使い回しの誤りが必ず出る
        fetchMock.mockResolvedValue(new Response("photo-bytes", { status: 200 }));
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/new.jpg`));
        handlers.fetch(e);
        await e.response;
        await new Promise((r) => setTimeout(r, 0));

        expect([...img.store.keys()], "やり直しで入っていない").toContain(`${CDN}/uploads/u1/new.jpg`);
    });

    it("リダイレクトの応答は控えない（追った先が分からない）", async () => {
        const redirected = new Response(null, { status: 200 });
        Object.defineProperty(redirected, "type", { value: "opaqueredirect" });
        fetchMock.mockResolvedValue(redirected);
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(e);
        await e.response;
        await new Promise((r) => setTimeout(r, 0));
        expect([...(caches_.get("journey-photo-img-v1")?.store.keys() ?? [])]).toEqual([]);
    });

    it("http:// の画像には手を出さない", async () => {
        fetchMock.mockResolvedValue(opaque());
        const e = makeEvent(imgRequest("http://example.com/uploads/u1/a.jpg"));
        handlers.fetch(e);
        expect(e.response).toBeUndefined();
    });

    // **手を出す先を最小にする。** 曲のアートワークや計測の画像には触らない
    it.each([
        [`https://is1-ssl.mzstatic.com/image/a.jpg`, "曲のアートワーク"],
        [`${CDN}/other/a.jpg`, "うちが組み立てないパス"],
    ])("%s（%s）は素通し", async (url) => {
        fetchMock.mockResolvedValue(opaque());
        const e = makeEvent(imgRequest(url));
        handlers.fetch(e);
        expect(e.response, "手を出している").toBeUndefined();
    });

    it("画像以外の要求（fetch など）は素通し", async () => {
        const req = new Request(`${CDN}/uploads/u1/a.jpg`, { method: "GET" });
        Object.defineProperty(req, "destination", { value: "" });
        const e = makeEvent(req);
        handlers.fetch(e);
        expect(e.response).toBeUndefined();
    });

    it("上限を超えたら古い順に捨てる", async () => {
        fetchMock.mockResolvedValue(opaque());
        for (let i = 0; i < 82; i++) {
            const e = makeEvent(imgRequest(`${CDN}/uploads/u1/${i}.jpg`));
            handlers.fetch(e);
            await e.response;
            await new Promise((r) => setTimeout(r, 0));
        }
        const keys = [...(caches_.get("journey-photo-img-v1")?.store.keys() ?? [])];
        expect(keys.length).toBe(80);
        expect(keys[0], "古い方から捨てていない").toBe(`${CDN}/uploads/u1/2.jpg`);
    });

    // **起動のたびに消さない。** ここを漏らすと元の「全消し」に逆戻りで、
    // オフラインで写真が出ない
    it("activate で写真の控えは消さない", async () => {
        await installed();   // ページ・資産の入れ物も作っておく
        fetchMock.mockResolvedValue(opaque());
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(e);
        await e.response;
        await new Promise((r) => setTimeout(r, 0));
        caches_.set("journey-photo-old", makeCache());

        const act = makeEvent();
        handlers.activate(act);
        await act.settle();

        expect([...caches_.keys()].sort()).toEqual(["journey-photo-img-v1", "journey-photo-v1"]);
    });

    // **ページ側の版を上げても写真は消さない。** 混ぜていた頃は、刻印の形式を
    // 変えるといった無関係な理由で全端末の写真の控えが消えた
    it("写真の入れ物の名前は、ページ側のバージョンを含まない", () => {
        const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
        expect(src).toMatch(/const IMG_CACHE_NAME = `journey-photo-img-\$\{IMG_CACHE_VERSION\}`/);
    });

    // 中身を確かめられる応答（同一オリジン・将来 CORS が付いた場合）は
    // 状態を見る。404 を控えない
    it("読める応答なら、失敗は控えない", async () => {
        fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/gone.jpg`));
        handlers.fetch(e);
        await e.response;
        await new Promise((r) => setTimeout(r, 0));
        expect([...(caches_.get("journey-photo-img-v1")?.store.keys() ?? [])]).toEqual([]);
    });

    // **Cache Storage が投げる端末（プライベートモード等）でも素通しに倒す。**
    // 投げたまま respondWith に渡すと、ネットワークが生きていても写真が
    // 1枚も出ない（fetch にすら行かない）
    it("控えを読めない端末でも、ネットワークが生きていれば出る", async () => {
        const broken = makeCache();
        broken.match = async () => { throw new Error("Cache Storage が使えない"); };
        caches_.set("journey-photo-img-v1", broken);

        fetchMock.mockResolvedValue(new Response("photo-bytes", { status: 200 }));
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(e);
        const res = await e.response!;
        expect(await res.text()).toBe("photo-bytes");
    });

    // 同じ形が `_next/static` 側にもある。あちらが投げると**サイトごと止まる**
    it("控えを読めない端末でも、_next/static は出る", async () => {
        const broken = makeCache();
        broken.match = async () => { throw new Error("Cache Storage が使えない"); };
        caches_.set("journey-photo-v1", broken);

        fetchMock.mockResolvedValue(new Response("chunk", { status: 200 }));
        const e = makeEvent(new Request("https://journey-photo.com/_next/static/chunks/a.js"));
        handlers.fetch(e);
        const res = await e.response!;
        expect(await res.text()).toBe("chunk");
    });

    it("オフラインで控えも無ければ、今までどおり失敗する", async () => {
        fetchMock.mockRejectedValue(new TypeError("offline"));
        const e = makeEvent(imgRequest(`${CDN}/uploads/u1/a.jpg`));
        handlers.fetch(e);
        await expect(e.response).rejects.toThrow();
    });
});
