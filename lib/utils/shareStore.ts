// Service Worker が PWA Share Target で受け取った写真を取り出す。
// SW 側のスキーマ（public/sw.js）と一致している必要がある。

const SHARE_DB = "journey-photo-share";
const SHARE_STORE = "files";

export type SharedPayload = {
    id: string;
    files: File[];
    title: string;
    text: string;
    t: number;
};

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SHARE_DB, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function readSharedPayload(): Promise<SharedPayload | null> {
    if (typeof indexedDB === "undefined") return null;
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(SHARE_STORE, "readonly");
            const req = tx.objectStore(SHARE_STORE).get("current");
            req.onsuccess = () => resolve((req.result as SharedPayload | undefined) ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

export async function clearSharedPayload(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(SHARE_STORE, "readwrite");
            const req = tx.objectStore(SHARE_STORE).clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        /* ignore */
    }
}
