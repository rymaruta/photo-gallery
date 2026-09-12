import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSharedResult, clearSharedPayload } from "@/lib/utils/shareStore";

/**
 * **共有シートから写真を送る経路（share target）に、テストが1本も無かった。**
 *
 * CLAUDE.md は「カメラ・共有まわりの不具合は『Webの改善』ではなく
 * 『アプリ化の前提』として扱ってよい」と書いている。その共有の契約が
 * **4か所に複製**されていて、どこを書き換えても誰も気づけなかった:
 *
 *   1. `public/manifest.webmanifest`  action / params.title / params.text /
 *                                     params.files[0].name
 *   2. `public/sw.js`                 pathname の一致・`getAll("photos")`・
 *                                     IndexedDB の名前と `id: "current"`
 *   3. `lib/utils/shareStore.ts`      同じ DB・ストア・キーを読む
 *   4. アップロード画面               `?from=share` を受け取る
 *
 * 壊れ方は**静か**——アップロード画面は普通に開いて、写真が無いだけ。
 *
 * **綴りの走査にはしない**（台帳: 3回続けて穴が開いた）。マニフェストの値を
 * **そのまま入力に使って実際に通し**、本物の `readSharedResult` で読み戻す。
 * 名前がどこかで1文字ずれれば、写真が届かなくなって落ちる。
 */

const ORIGIN = "https://journey-photo.com";
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8")) as {
    share_target?: {
        action?: string; method?: string; enctype?: string;
        params?: { title?: string; text?: string; files?: { name?: string; accept?: string[] }[] };
    };
};

/**
 * 本物の IndexedDB に寄せた偽物。**SW が書いた先を、画面側の実装がそのまま読む。**
 * ここを2つに分けると「名前がずれていても両方が自分の入れ物で完結する」ので、
 * この テストが確かめたいこと（4か所の一致）が確かめられなくなる。
 */
function makeIdb() {
    const dbs = new Map<string, Map<string, Map<string, unknown>>>();
    const later = (fn: () => void) => setTimeout(fn, 0);

    function handle(name: string) {
        const stores = dbs.get(name)!;
        return {
            createObjectStore(storeName: string) { stores.set(storeName, new Map()); return {}; },
            transaction(storeName: string) {
                const data = stores.get(storeName);
                if (!data) throw new DOMException("no such store", "NotFoundError");
                const tx: Record<string, unknown> = {};
                let pending = 0;
                let done = false;
                const settle = () => {
                    if (pending > 0 || done) return;
                    done = true;
                    (tx.oncomplete as (() => void) | undefined)?.();
                };
                const request = <T>(work: () => T) => {
                    pending++;
                    const r: Record<string, unknown> = {};
                    later(() => {
                        r.result = work();
                        (r.onsuccess as (() => void) | undefined)?.();
                        pending--;
                        later(settle);
                    });
                    return r;
                };
                tx.objectStore = () => ({
                    clear: () => request(() => { data.clear(); }),
                    put: (v: { id: string }) => request(() => { data.set(v.id, v); return v.id; }),
                    get: (k: string) => request(() => data.get(k)),
                });
                return tx;
            },
        };
    }

    return {
        open(name: string) {
            const fresh = !dbs.has(name);
            if (fresh) dbs.set(name, new Map());
            const req: Record<string, unknown> = {};
            later(() => {
                req.result = handle(name);
                if (fresh) (req.onupgradeneeded as (() => void) | undefined)?.();
                (req.onsuccess as (() => void) | undefined)?.();
            });
            return req;
        },
        _dbs: dbs,
    };
}

/**
 * **Node の `Response.redirect` は相対URLを解決しない**（`TypeError: Failed to
 * parse URL`）。実ブラウザは Service Worker のスコープを基準に解決する
 * ——Chromium で実際に SW を登録して測った:
 *
 *     relative  ok status=303 loc=http://localhost:8799/user/upload?from=share
 *
 * なので**実装ではなくハーネスの側を実ブラウザに合わせる**。
 */
class SwResponse extends Response {
    static redirect(url: string, status?: number) {
        return Response.redirect(new URL(url, ORIGIN).toString(), status);
    }
}

type Handler = (event: unknown) => void;
let handlers: Record<string, Handler>;
let idb: ReturnType<typeof makeIdb>;

function loadSw() {
    handlers = {};
    idb = makeIdb();
    const self_ = {
        addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
        skipWaiting: async () => undefined,
        clients: { claim: async () => undefined },
        caches: { open: async () => ({ match: async () => undefined, put: async () => undefined, add: async () => undefined, keys: async () => [], delete: async () => false }), keys: async () => [], delete: async () => false, match: async () => undefined },
        location: { origin: ORIGIN },
    };
    const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    new Function("self", "caches", "fetch", "indexedDB", "Response", "URL", "File", "console", src)(
        self_, self_.caches, async () => new Response(""), idb, SwResponse, URL, File, console,
    );
}

/**
 * 共有シートが投げてくる要求。
 *
 * **本物の `Request` は使えない**——この環境の `FormData` は undici 実装で、
 * jsdom の `File`/`Blob` を multipart に載せると名前も中身も落ちる
 * （実測: `name=blob size=9`）。それは**ブラウザの multipart 解析の話**で、
 * ここで確かめたいのは**項目名と保存先の一致**なので、解析済みの
 * `FormData` を返す形にする。
 */
function shareRequest(fd: FormData, action: string) {
    return { method: "POST", url: new URL(action, ORIGIN).toString(), formData: async () => fd };
}

function makeEvent(request: unknown) {
    let responded: Promise<Response> | undefined;
    return {
        request,
        waitUntil: () => undefined,
        respondWith: (p: Promise<Response>) => { responded = p; },
        get response() { return responded; },
    };
}

const st = manifest.share_target ?? {};
const ACTION = st.action ?? "";
const FILES_FIELD = st.params?.files?.[0]?.name ?? "";
const TITLE_FIELD = st.params?.title ?? "";
const TEXT_FIELD = st.params?.text ?? "";

beforeEach(() => {
    loadSw();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: idb });
});

describe("共有シートから送った写真が、アップロード画面まで届く", () => {
    // マニフェストが宣言していなければ、以下は全部「たまたま通る」ので
    // 先に断つ（`params` を空にする変異が素通りしないように）
    it("マニフェストが share target を宣言している", () => {
        expect(ACTION, "action が無い").toBeTruthy();
        expect(st.method, "POST でないと SW の分岐に来ない").toBe("POST");
        expect(st.enctype, "ファイルを送るには multipart/form-data").toBe("multipart/form-data");
        expect(FILES_FIELD, "files[0].name が無い").toBeTruthy();
        expect(st.params?.files?.[0]?.accept, "画像を受け取ると宣言していない").toContain("image/*");
        expect(TITLE_FIELD).toBeTruthy();
        expect(TEXT_FIELD).toBeTruthy();
    });

    // **ここが本題。** マニフェストの項目名をそのまま使って投げ、
    // 本物の `readSharedResult` で読み戻す。SW 側の `getAll("photos")` や
    // IndexedDB の名前・`id: "current"` が1文字でもずれたら写真が消える
    it("マニフェストが宣言した項目名で送ると、画面側がその写真を読み出せる", async () => {
        const fd = new FormData();
        fd.append(FILES_FIELD, new File([new Uint8Array([1, 2, 3])], "kumokai.jpg", { type: "image/jpeg" }));
        fd.append(FILES_FIELD, new File([new Uint8Array([4, 5])], "nemophila.png", { type: "image/png" }));
        fd.append(TITLE_FIELD, "高屋神社の雲海");
        fd.append(TEXT_FIELD, "本文");

        const e = makeEvent(shareRequest(fd, ACTION));
        handlers.fetch(e);
        await e.response;

        const read = await readSharedResult();
        expect(read.ok, "受け皿を開けなかった").toBe(true);
        if (!read.ok) return;
        expect(read.payload, "共有した中身が1つも入っていない").not.toBeNull();
        expect(read.payload!.files.map((f) => f.name)).toEqual(["kumokai.jpg", "nemophila.png"]);
        expect(read.payload!.title).toBe("高屋神社の雲海");
        expect(read.payload!.text).toBe("本文");
    });

    // 受け取ったあとの着地。`?from=share` は画面が「共有から来た」と
    // 見分ける唯一の手がかり（`578022b7` で使い終わりに落とす形にした）
    it("受け取ったら、マニフェストと同じ画面へ 303 で送る", async () => {
        const fd = new FormData();
        fd.append(FILES_FIELD, new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }));
        const e = makeEvent(shareRequest(fd, ACTION));
        handlers.fetch(e);
        const res = await e.response!;

        expect(res.status).toBe(303);
        const loc = new URL(res.headers.get("location")!);
        expect(loc.pathname, "マニフェストの action と違う画面へ送っている").toBe(new URL(ACTION, ORIGIN).pathname);
        expect(loc.searchParams.get("from")).toBe("share");
    });

    // **写真だけを拾う。** `instanceof File` を落とすと、テキスト項目まで
    // 「写真」として保存され、画面が読めないものを並べる
    it("ファイルでない項目は写真として拾わない", async () => {
        const fd = new FormData();
        fd.append(FILES_FIELD, "これはただの文字列");
        fd.append(FILES_FIELD, new File([new Uint8Array([1])], "real.jpg", { type: "image/jpeg" }));
        const e = makeEvent(shareRequest(fd, ACTION));
        handlers.fetch(e);
        await e.response;

        const read = await readSharedResult();
        expect(read.ok && read.payload!.files.map((f) => f.name)).toEqual(["real.jpg"]);
    });

    // 前回の共有が残っていると、今回送っていない写真が並ぶ
    it("前回の共有は残さない", async () => {
        const first = new FormData();
        first.append(FILES_FIELD, new File([new Uint8Array([1])], "old.jpg", { type: "image/jpeg" }));
        const e1 = makeEvent(shareRequest(first, ACTION));
        handlers.fetch(e1);
        await e1.response;

        const second = new FormData();
        second.append(FILES_FIELD, new File([new Uint8Array([2])], "new.jpg", { type: "image/jpeg" }));
        const e2 = makeEvent(shareRequest(second, ACTION));
        handlers.fetch(e2);
        await e2.response;

        const read = await readSharedResult();
        expect(read.ok && read.payload!.files.map((f) => f.name)).toEqual(["new.jpg"]);
    });

    // 題も本文も付けずに送れる（共有元によっては付かない）。
    // `?? ""` を落とすと undefined が入って画面が `[object Undefined]` を出す
    it("題も本文も無い共有でも、写真は届く", async () => {
        const fd = new FormData();
        fd.append(FILES_FIELD, new File([new Uint8Array([1])], "only.jpg", { type: "image/jpeg" }));
        const e = makeEvent(shareRequest(fd, ACTION));
        handlers.fetch(e);
        await e.response;

        const read = await readSharedResult();
        expect(read.ok && read.payload!.title).toBe("");
        expect(read.ok && read.payload!.text).toBe("");
    });

    // **受け皿の後始末も同じ入れ物を指しているか。** ここがずれると
    // 「一度共有すると、以後アップロード画面を開くたびに同じ写真が並ぶ」
    it("画面側の後始末が、SW が書いた先を消す", async () => {
        const fd = new FormData();
        fd.append(FILES_FIELD, new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }));
        const e = makeEvent(shareRequest(fd, ACTION));
        handlers.fetch(e);
        await e.response;

        await clearSharedPayload();
        const read = await readSharedResult();
        expect(read.ok && read.payload).toBeNull();
    });

    // 共有以外の POST に手を出さない（触らなければ壊せない）
    it("別の画面への POST には手を出さない", async () => {
        const e = makeEvent({ method: "POST", url: `${ORIGIN}/user/profile`, formData: async () => new FormData() });
        handlers.fetch(e);
        expect(e.response, "無関係な POST を横取りしている").toBeUndefined();
    });
});
