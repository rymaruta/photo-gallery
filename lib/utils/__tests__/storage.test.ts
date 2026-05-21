import { describe, it, expect, beforeEach } from "vitest";
import { storageGet, storageSet, storageRemove } from "../storage";

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
        store,
    };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

beforeEach(() => localStorageMock.clear());

describe("storageGet", () => {
    it("存在するキーの値を返す", () => {
        localStorageMock.setItem("k", JSON.stringify({ a: 1 }));
        expect(storageGet<{ a: number }>("k")).toEqual({ a: 1 });
    });

    it("存在しないキーは undefined を返す", () => {
        expect(storageGet("missing")).toBeUndefined();
    });

    it("不正な JSON は undefined を返す", () => {
        localStorageMock.setItem("bad", "not-json{{{");
        expect(storageGet("bad")).toBeUndefined();
    });

    it("配列を正しく復元する", () => {
        localStorageMock.setItem("arr", JSON.stringify(["a", "b"]));
        expect(storageGet<string[]>("arr")).toEqual(["a", "b"]);
    });
});

describe("storageSet", () => {
    it("値を JSON 文字列として保存する", () => {
        storageSet("key", { x: 42 });
        expect(localStorageMock.getItem("key")).toBe(JSON.stringify({ x: 42 }));
    });

    it("配列を保存できる", () => {
        storageSet("arr", [1, 2, 3]);
        expect(JSON.parse(localStorageMock.getItem("arr")!)).toEqual([1, 2, 3]);
    });

    it("null を保存できる", () => {
        storageSet("null", null);
        expect(localStorageMock.getItem("null")).toBe("null");
    });
});

describe("storageRemove", () => {
    it("キーを削除する", () => {
        localStorageMock.setItem("del", "v");
        storageRemove("del");
        expect(localStorageMock.getItem("del")).toBeNull();
    });

    it("存在しないキーを削除してもエラーにならない", () => {
        expect(() => storageRemove("nope")).not.toThrow();
    });
});
