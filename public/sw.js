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

// 最初に必ず持っておくもの。トップページはオフラインの受け皿にも使う。
const PRECACHE_URLS = ["/", "/manifest.webmanifest"];

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
 * ページ（ナビゲーション）は**必ずネットワーク優先**。
 * キャッシュを先に返すと古いアプリシェルを配信し続け、
 * 「表示はされるが一切タップできない」に戻る。
 * 落ちたときだけ、同じURLの控え → トップページ の順に出す。
 */
async function handleNavigate(request) {
    try {
        const res = await fetch(request);
        if (isStorable(res)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => undefined);
        }
        return res;
    } catch (e) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const shell = await caches.match("/");
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
    // 自分自身と設定ファイルは触らない（デプロイが no-store で配っている）
    if (url.pathname === "/sw.js") return;

    if (event.request.mode === "navigate") {
        event.respondWith(handleNavigate(event.request));
        return;
    }
    if (isImmutableAsset(url)) {
        event.respondWith(handleImmutable(event.request));
    }
});
