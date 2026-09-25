import { describe, it, expect, vi } from "vitest";
import { isDraftFresh, DRAFT_MAX_AGE_MS, readUploadDraft, saveUploadDraft, clearUploadDraft } from "../uploadDraft";

describe("書きかけの控え（docs/ios-bug-audit-2026-09-25.md #8）", () => {
    it("6時間より新しいものだけ戻す。時計を巻き戻した端末の負の経過時間は「新しい」にしない", () => {
        const now = 1_000_000_000;
        expect(isDraftFresh({ t: now - 1000 }, now)).toBe(true);
        expect(isDraftFresh({ t: now - DRAFT_MAX_AGE_MS }, now)).toBe(false);
        expect(isDraftFresh({ t: now + 5000 }, now)).toBe(false);
    });

    it("IndexedDB が無い環境では何もしない（投げない）", async () => {
        expect(typeof indexedDB).toBe("undefined");
        await expect(saveUploadDraft({ t: 1, userId: "u1", category: "", tags: "", asOnePost: false, items: [] })).resolves.toBeUndefined();
        await expect(readUploadDraft("u1")).resolves.toBeNull();
        await expect(clearUploadDraft()).resolves.toBeUndefined();
    });
});

// 投稿画面はログアウトの直後に閉じ、閉じるときに今の状態を書き直す。
// 消した控えを前の人の写真で書き戻さないよう、次にログインするまで書かない。
describe("ログアウト・退会のあと", () => {
    it("forgetUploadDraftOnSignOut のあとは、allowUploadDraft まで書かない", async () => {
        const { forgetUploadDraftOnSignOut, allowUploadDraft, saveUploadDraft: save } = await import("../uploadDraft");
        const opened: string[] = [];
        const fakeIdb = { open: (name: string) => { opened.push(name); return { set onsuccess(_f: unknown) {}, set onerror(_f: unknown) {}, set onupgradeneeded(_f: unknown) {} }; } };
        vi.stubGlobal("indexedDB", fakeIdb);
        try {
            void forgetUploadDraftOnSignOut();
            opened.length = 0;
            void save({ t: 1, userId: "a", category: "", tags: "", asOnePost: false, items: [] });
            expect(opened, "ログアウトのあとに書いた").toEqual([]);
            allowUploadDraft();
            void save({ t: 1, userId: "b", category: "", tags: "", asOnePost: false, items: [] });
            expect(opened).toEqual(["journey-photo-draft"]);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

// 投稿画面を開いた別のタブは、こちらのタブのモジュール変数に気づかない（76f7c7b のレビュー）
describe("別のタブでのログアウト", () => {
    it("localStorage の印があれば、このタブのモジュール変数に関係なく書かない", async () => {
        const { allowUploadDraft, saveUploadDraft: save } = await import("../uploadDraft");
        allowUploadDraft();
        const opened: string[] = [];
        vi.stubGlobal("indexedDB", { open: (name: string) => { opened.push(name); return {}; } });
        try {
            localStorage.setItem("jp_upload_draft_signed_out", "1"); // 別のタブがログアウトした
            void save({ t: 1, userId: "a", category: "", tags: "", asOnePost: false, items: [] });
            expect(opened, "別のタブでログアウトしたのに書いた").toEqual([]);
            allowUploadDraft(); // 次にログインした
            expect(localStorage.getItem("jp_upload_draft_signed_out")).toBeNull();
        } finally {
            vi.unstubAllGlobals();
            localStorage.removeItem("jp_upload_draft_signed_out");
        }
    });
});
