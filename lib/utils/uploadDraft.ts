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
    /**
     * S3 までは上がったが保存で落ちた写真の置き場所。**控えて戻す**——
     * 押し直したときに同じ置き場所を使い回す（取り直すと、参照されない
     * オブジェクトが S3 に増える。投稿画面の `Item.uploaded` と同じ理由）
     */
    uploaded?: { key: string; publicUrl: string; thumbUrl?: string };
};

export type UploadDraft = {
    t: number;
    /** 控えた人。**別の人には戻さない**（ログアウトを通らずにセッションが切れた端末） */
    userId: string;
    category: string;
    tags: string;
    asOnePost: boolean;
    /**
     * 公開範囲（`lib/utils/audience.ts` の値）。**控えないと、戻ったときに黙って
     * 「全体に公開」になる**——「親しい友達」を選んで設定へ行き、戻って投稿すると
     * ウェブサイトと検索に載った（情報が開く方へ倒れる）。古い控えには無い
     */
    audience?: string;
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

/**
 * **ログアウト・退会のあとは、次にログインするまで控えない。**
 * 投稿画面はログアウトの直後に閉じる（アンマウントで今の状態を書き直す）ので、
 * 消した控えを前の人の写真で書き戻さないようにする。セッションが切れただけ
 * （ログアウトを通らない）のときは止めない——写真を守っている最中だから。
 */
let blockedAfterSignOut = false;
/**
 * **別のタブでのログアウト・退会にも効かせる。** モジュールの変数はタブごと
 * なので、投稿画面を開いている別のタブは気づかず、前の人の写真を書き戻して
 * いた。印を localStorage にも置く（タブをまたいで読める）
 */
const SIGNED_OUT_KEY = "jp_upload_draft_signed_out";

function signedOutElsewhere(): boolean {
    try { return localStorage.getItem(SIGNED_OUT_KEY) === "1"; } catch { return false; }
}

/** ログアウト・退会で呼ぶ。控えを消し、次にログインするまで書かせない */
export async function forgetUploadDraftOnSignOut(): Promise<void> {
    blockedAfterSignOut = true;
    try { localStorage.setItem(SIGNED_OUT_KEY, "1"); } catch { /* 使えない端末ではこのタブだけ止める */ }
    await clearUploadDraft();
}

/** ログインが分かったら呼ぶ（書いてよい状態に戻す） */
export function allowUploadDraft(): void {
    blockedAfterSignOut = false;
    try { localStorage.removeItem(SIGNED_OUT_KEY); } catch { /* 無くてよい */ }
}

/** 控える。**失敗しても投げない**（プライベートモード・容量不足。画面は止めない） */
export async function saveUploadDraft(draft: UploadDraft): Promise<void> {
    if (typeof indexedDB === "undefined" || blockedAfterSignOut || signedOutElsewhere()) return;
    try { await run("readwrite", (s) => s.put(draft, DRAFT_KEY)); } catch { /* 控えられなくても続ける */ }
}

/** 戻せる控えを読む。無い・古い・別の人の・読めないは null（戻せないものはついでに消す） */
export async function readUploadDraft(userId: string, now = Date.now()): Promise<UploadDraft | null> {
    if (typeof indexedDB === "undefined") return null;
    try {
        const d = await run<UploadDraft | undefined>("readonly", (s) => s.get(DRAFT_KEY));
        if (!d || !Array.isArray(d.items) || d.items.length === 0) return null;
        if (!isDraftFresh(d, now) || !userId || d.userId !== userId) { await clearUploadDraft(); return null; }
        return d;
    } catch {
        return null;
    }
}

export async function clearUploadDraft(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try { await run("readwrite", (s) => s.delete(DRAFT_KEY)); } catch { /* 無ければそれでよい */ }
}
