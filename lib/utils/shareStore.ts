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

/**
 * 受け皿を読めたか。**「何も無い」と「読めなかった」を分ける。**
 *
 * どちらも `null` にしていたので、共有シートから送ったのに
 * IndexedDB が使えない端末（プライベートモード・ストレージ拒否）では
 * **アップロード画面が開いて、写真が無いだけ**——利用者には何も言わずに
 * 終わっていた。呼び出し側が理由を出せるように分ける。
 */
export type ShareReadResult =
    | { ok: true; payload: SharedPayload | null }   // 読めた（中身が無いことはある）
    | { ok: false };                                // 受け皿を開けなかった

export async function readSharedResult(): Promise<ShareReadResult> {
    if (typeof indexedDB === "undefined") return { ok: false };
    try {
        const db = await openDb();
        const payload = await new Promise<SharedPayload | null>((resolve, reject) => {
            const tx = db.transaction(SHARE_STORE, "readonly");
            const req = tx.objectStore(SHARE_STORE).get("current");
            req.onsuccess = () => resolve((req.result as SharedPayload | undefined) ?? null);
            req.onerror = () => reject(req.error);
        });
        return { ok: true, payload };
    } catch {
        return { ok: false };
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
