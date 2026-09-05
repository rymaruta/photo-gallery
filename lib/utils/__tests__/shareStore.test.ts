import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSharedResult } from "../shareStore";

// **「何も無い」と「読めなかった」を分ける。**
// どちらも null にしていたので、共有シートから送ったのに IndexedDB が
// 使えない端末（プライベートモード・ストレージ拒否）では、
// アップロード画面が開いて写真が無いだけ——何も言わずに終わっていた。

/** 開けない IndexedDB（open が onerror になる） */
function failingIndexedDb() {
    return {
        open: () => {
            const req: Record<string, unknown> = { error: new DOMException("blocked", "SecurityError") };
            setTimeout(() => (req.onerror as (() => void) | undefined)?.(), 0);
            return req;
        },
    };
}

/** 開けるが「current」が入っていない IndexedDB */
function emptyIndexedDb() {
    const store = { get: () => { const r: Record<string, unknown> = { result: undefined }; setTimeout(() => (r.onsuccess as (() => void) | undefined)?.(), 0); return r; } };
    const db = { transaction: () => ({ objectStore: () => store }) };
    return {
        open: () => {
            const req: Record<string, unknown> = { result: db };
            setTimeout(() => (req.onsuccess as (() => void) | undefined)?.(), 0);
            return req;
        },
    };
}

/** 「current」に中身が入っている IndexedDB */
function withRecord(record: unknown) {
    const store = { get: () => { const r: Record<string, unknown> = { result: record }; setTimeout(() => (r.onsuccess as (() => void) | undefined)?.(), 0); return r; } };
    const db = { transaction: () => ({ objectStore: () => store }) };
    return {
        open: () => {
            const req: Record<string, unknown> = { result: db };
            setTimeout(() => (req.onsuccess as (() => void) | undefined)?.(), 0);
            return req;
        },
    };
}

const setIdb = (value: unknown) =>
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value });

beforeEach(() => { vi.restoreAllMocks(); });

describe("共有の受け皿を読む", () => {
    it("開けなかったら ok:false（『中身が無い』と混ぜない）", async () => {
        setIdb(failingIndexedDb());
        expect(await readSharedResult()).toEqual({ ok: false });
    });

    it("indexedDB が無い環境でも ok:false", async () => {
        Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
        expect(await readSharedResult()).toEqual({ ok: false });
    });

    it("開けて中身が無ければ ok:true・payload は null", async () => {
        setIdb(emptyIndexedDb());
        expect(await readSharedResult()).toEqual({ ok: true, payload: null });
    });

    // **中身をそのまま返すことを縛る。** ここが無いと `payload` を捨てる
    // 変異（`payload: null` を返す）が**フルスイート2,925件を素通り**した
    // ——画面側は `shareStore` をモックするので実装に触れず、単体テストは
    // 「開けない」「空」しか見ていなかった（レビューが実測）
    it("受け皿に入っていれば、その中身をそのまま返す", async () => {
        const record = { id: "current", files: [], title: "旅の写真", text: "本文", t: 12345 };
        setIdb(withRecord(record));
        expect(await readSharedResult()).toEqual({ ok: true, payload: record });
    });
});
