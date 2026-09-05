import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSharedResult, readSharedPayload } from "../shareStore";

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

    // 従来の口は「中身だけ」を返す（読めない場合も null）——呼び出し側が
    // 理由を要らないときのため
    it("readSharedPayload はどちらでも null", async () => {
        setIdb(failingIndexedDb());
        expect(await readSharedPayload()).toBeNull();
        setIdb(emptyIndexedDb());
        expect(await readSharedPayload()).toBeNull();
    });
});
