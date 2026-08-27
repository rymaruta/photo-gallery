// Journey Photo Service Worker
//
// 役割は2つ:
//   1. PWA Share Target の POST を受け取り、ファイルを IndexedDB に格納してから
//      /user/upload?from=share へリダイレクトする
//   2. オフラインでも「一度見たページが開く」ようにする
//
// **2 は後から足した。** それまでは GET を一切キャッシュしないどころか、
// 起動のたびに Cache Storage を全消ししていたので、ホーム画面に追加できて
// 全画面で開くのに**機内モードではブラウザのエラー画面**になっていた。
//
// 設計の方針（この順で優先する）:
//   - **戻ってきた人のサイトを壊さない。** HTML は必ずネットワーク優先。
//     キャッシュを先に返すと、古いアプリシェルを配信し続けて
//     「表示はされるが一切タップできない」に戻る（過去に踏んだ形）
//   - `_next/static/**` だけキャッシュ優先。中身がハッシュ名なので、
//     内容が変われば必ず別のURLになる＝古いものを返しようがない
//   - 判断が付かないものはキャッシュしない。想定外は素通し
//
// **画像はまだキャッシュしていない。** 上限管理（追い出し）が要るので
// 別枠にした。今の目的は「機内モードで開けること」まで。

const SHARE_DB = "journey-photo-share";
const SHARE_STORE = "files";

// キャッシュ名にバージョンを持たせる。**activate で他のバージョンだけ消す**
// （全消しに戻すと、自分が入れたばかりの分まで毎回消えてオフラインが0点に戻る）。
const CACHE_VERSION = "v1";
const CACHE_NAME = `journey-photo-${CACHE_VERSION}`;

/**
 * オフラインの受け皿。**JavaScript を要求しないページにすること。**
 *
 * 最初は `/` の HTML を使っていたが、Next のページは必ず
 * `/_next/static` のチャンクを要求する。それらは実際に一度取得したときしか
 * キャッシュに入らないので、「検索から /photo/xxx に来てホーム画面に追加した
 * が、トップページは一度も開いていない」端末では**JS の揃わない HTML**が出る。
 * すると React が動かず `data-hydrated` が付かず、app/layout.tsx の水和
 * ウォッチドッグが12秒後に **Cache Storage を全消しして SW を解除**し、
 * オフラインのまま再読込 → ブラウザのエラー画面。オフライン機能ごと消える
 * 自壊コースだった。素の HTML なら水和もチャンクも要らない。
 */
const OFFLINE_URL = "/offline.html";

// 最初に必ず持っておくもの
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            // 1つでも失敗したら install ごと落ちる addAll は使わない
            // （オフラインで開いた瞬間に更新が入ると、その後ずっと入らない）。
            await Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => undefined)));
        } catch (e2) {
            // 取れなくても起動は続ける
        }
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
    // **他のバージョンだけ消す。** 以前はここで全消ししていた——GET を
    // 一切キャッシュしない設計だったので「残存キャッシュは古いアプリシェルを
    // 配信し続ける原因にしかならない」という理由づけで、それ自体は正しかった。
    // キャッシュを持つようになった今は、消す対象を自分の旧版に限る。
    try {
        if (self.caches && caches.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
        }
    } catch (e2) {
        // 失敗しても致命的ではない
    }
    await self.clients.claim();
})()));

function openShareDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SHARE_DB, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveSharedFiles(files, title, text) {
    const db = await openShareDb();
    const tx = db.transaction(SHARE_STORE, "readwrite");
    const store = tx.objectStore(SHARE_STORE);
    // 既存の共有データはクリア（前回分が残らないように）
    await new Promise((resolve, reject) => {
        const clearReq = store.clear();
        clearReq.onsuccess = () => resolve();
        clearReq.onerror = () => reject(clearReq.error);
    });
    const id = "current";
    store.put({ id, files, title: title ?? "", text: text ?? "", t: Date.now() });
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 保存してよい応答か。判断が付かないものは入れない */
function isStorable(res) {
    if (!res || !res.ok || res.status !== 200) return false;
    // opaque（cross-origin の no-cors）は中身を確かめられないうえ容量も食う。
    // opaqueredirect も同じ。206（部分）は status で落ちる。
    //
    // ここを `type === "basic"` と書くと、意図（opaque を入れない）より狭い
    // うえに**ブラウザ専用の値**に依存する（Node の Response は "default"）。
    // 呼ぶ前に同一オリジンへ絞ってあるので、除外側を書く方が正確。
    return res.type !== "opaque" && res.type !== "opaqueredirect";
}

/** 中身がハッシュ名の資産。内容が変われば必ず別のURLになる */
function isImmutableAsset(url) {
    return url.pathname.startsWith("/_next/static/");
}

/**
 * ページの控えのキー。**クエリを落とす。**
 *
 * Cache API はクエリまで含めて別物として扱うので、
 * `?utm_source=` `?fbclid=` の付いた検索・SNS 流入が、同じページなのに
 * 際限なく別エントリになる。静的書き出しでは同じ HTML なので分ける意味が無い。
 */
function navKey(request) {
    const u = new URL(request.url);
    return u.origin + u.pathname;
}

/** ページの控えの上限。超えたら古い順に捨てる（Cache API のキーは挿入順） */
const MAX_PAGE_ENTRIES = 60;

/**
 * 控えを受け皿として出してよい期限。
 *
 * Cache API は Cache-Control を見ない。デプロイ側は「HTML は no-store
 * 配信だから即削除して安全」という前提で古いキーを消しているので、
 * ここに寿命が無いと**削除した写真・非公開にした写真のページが、それを
 * 見たことのある端末に残り続ける**（消える経路が「本人がその URL を
 * 再訪してオンラインで成功する」しかない）。日をまたぐ程度で切る。
 */
const PAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAMP_HEADER = "x-sw-cached-at";

/** 保存時刻を刻んで控える。body は clone 済みのものを渡すこと */
function withStamp(res) {
    const headers = new Headers(res.headers);
    headers.set(STAMP_HEADER, String(Date.now()));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** 受け皿として出してよいほど新しいか */
function isFreshEnough(res) {
    const at = Number(res && res.headers && res.headers.get(STAMP_HEADER));
    if (!at) return false;
    return Date.now() - at < PAGE_MAX_AGE_MS;
}

/** 上限を超えたぶんを古い順に捨てる */
async function trimPages(cache) {
    try {
        const keys = await cache.keys();
        const extra = keys.length - MAX_PAGE_ENTRIES;
        for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
    } catch (e) {
        // 捨てられなくても致命的ではない
    }
}

/**
 * ページ（ナビゲーション）は**必ずネットワーク優先**。
 * キャッシュを先に返すと古いアプリシェルを配信し続け、
 * 「表示はされるが一切タップできない」に戻る。
 * 落ちたときだけ、同じURLの控え → トップページ の順に出す。
 */
async function handleNavigate(request) {
    try {
        const res = await fetch(request);
        if (isStorable(res)) {
            const stamped = withStamp(res.clone());
            caches.open(CACHE_NAME).then(async (c) => {
                await c.put(navKey(request), stamped);
                await trimPages(c);
                // precache を取り逃していたら、ここで埋める。install は
                // sw.js のバイトが変わるまで再実行されないので、
                // 一度失敗すると受け皿がゼロのままになる。
                if (!(await c.match(OFFLINE_URL))) await c.add(OFFLINE_URL).catch(() => undefined);
            }).catch(() => undefined);
        }
        return res;
    } catch (e) {
        const cached = await caches.match(navKey(request), { cacheName: CACHE_NAME });
        // 古すぎる控えは出さない（消したはずのページを出さないため）
        if (cached && isFreshEnough(cached)) return cached;
        const shell = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME });
        if (shell) return shell;
        throw e;
    }
}

/** ハッシュ名の資産だけキャッシュ優先（古いものを返しようがない） */
async function handleImmutable(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (isStorable(res)) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => undefined);
    }
    return res;
}

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Share Target: POST /user/upload を受け取る
    if (event.request.method === "POST" && url.pathname === "/user/upload") {
        event.respondWith((async () => {
            try {
                const formData = await event.request.formData();
                const files = formData.getAll("photos").filter((f) => f instanceof File);
                const title = formData.get("title");
                const text = formData.get("text");
                await saveSharedFiles(files, title, text);
            } catch (e) {
                // 失敗してもアップロードページには遷移させる
                console.error("[sw] share target error:", e);
            }
            return Response.redirect("/user/upload?from=share", 303);
        })());
        return;
    }

    // ここから下は GET・同一オリジンだけ。**それ以外は素通し**
    // （API・画像CDN・計測などに手を出さない。触らなければ壊せない）。
    if (event.request.method !== "GET") return;
    if (url.origin !== self.location.origin) return;
    // ※ `/sw.js` の除外は置かない。**死にコードだから。**
    //   ブラウザが SW スクリプトを取りに行く要求は fetch イベントに来ないし、
    //   ページから明示的に `fetch("/sw.js")` しても navigate でも
    //   `_next/static` でもないので、どのみち素通しになる。
    //   「守っているつもりの1行」を残さない。

    if (event.request.mode === "navigate") {
        event.respondWith(handleNavigate(event.request));
        return;
    }
    if (isImmutableAsset(url)) {
        event.respondWith(handleImmutable(event.request));
    }
});
