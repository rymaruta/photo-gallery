import { describe, it, expect } from "vitest";
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
        await expect(saveUploadDraft({ t: 1, category: "", tags: "", asOnePost: false, items: [] })).resolves.toBeUndefined();
        await expect(readUploadDraft()).resolves.toBeNull();
        await expect(clearUploadDraft()).resolves.toBeUndefined();
    });
});
