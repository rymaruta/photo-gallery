// Journey Photo Service Worker
// 主な役割: PWA Share Target の POST を受け取り、ファイルを IndexedDB に格納してから
//          /user/upload?from=share へリダイレクトする。

const SHARE_DB = "journey-photo-share";
const SHARE_STORE = "files";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
    }
});
