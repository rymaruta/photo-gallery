// 投稿画面の「書きかけ」を端末に控える。
//
// **iOS はバックグラウンドのページを黙って捨てる。** カメラや写真の選択から
// 戻ったとき、別のアプリを見ている間に、メモリが足りないとページが破棄され、
// 戻ると読み込み直しになる——選んだ写真も、打った題名・説明も消えていた
// （docs/ios-bug-audit-2026-09-25.md #8）。ホーム画面から起動したアプリでは特に多い。
//
// 画面が隠れる瞬間（visibilitychange → hidden / pagehide）に、まだ上げていない
// 写真と入力を IndexedDB に控え、開き直したときに戻す。写真（File）ごと控える
// ので sessionStorage では足りない。控えは1つだけ（上書き）。

const DRAFT_DB = "journey-photo-draft";
const DRAFT_STORE = "draft";
const DRAFT_KEY = "current";

/** これより古い控えは戻さない（翌日に開いて、覚えのない写真が並ぶのを避ける） */
export const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type DraftItem = {
    file: File;
    title: string;
    description: string;
    location: string;
    focalPoint?: { x: number; y: number };
    dateTimeOriginal?: string;
    latitude?: number;
    longitude?: number;
};

export type UploadDraft = {
    t: number;
    category: string;
    tags: string;
    asOnePost: boolean;
    items: DraftItem[];
};

/** 控えを戻してよいか。**時計を巻き戻した端末で、負の経過時間を「新しい」にしない** */
export function isDraftFresh(draft: Pick<UploadDraft, "t">, now: number): boolean {
    const age = now - draft.t;
    return age >= 0 && age < DRAFT_MAX_AGE_MS;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DRAFT_DB, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(DRAFT_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return openDb().then((db) => new Promise<T>((resolve, reject) => {
        const tx = db.transaction(DRAFT_STORE, mode);
        const req = fn(tx.objectStore(DRAFT_STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    }));
}

/** 控える。**失敗しても投げない**（プライベートモード・容量不足。画面は止めない） */
export async function saveUploadDraft(draft: UploadDraft): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try { await run("readwrite", (s) => s.put(draft, DRAFT_KEY)); } catch { /* 控えられなくても続ける */ }
}

/** 戻せる控えを読む。無い・古い・読めないは null（古いものはついでに消す） */
export async function readUploadDraft(now = Date.now()): Promise<UploadDraft | null> {
    if (typeof indexedDB === "undefined") return null;
    try {
        const d = await run<UploadDraft | undefined>("readonly", (s) => s.get(DRAFT_KEY));
        if (!d || !Array.isArray(d.items) || d.items.length === 0) return null;
        if (!isDraftFresh(d, now)) { await clearUploadDraft(); return null; }
        return d;
    } catch {
        return null;
    }
}

export async function clearUploadDraft(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try { await run("readwrite", (s) => s.delete(DRAFT_KEY)); } catch { /* 無ければそれでよい */ }
}
