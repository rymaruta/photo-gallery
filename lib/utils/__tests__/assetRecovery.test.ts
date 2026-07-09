import { describe, it, expect, beforeEach } from "vitest";
import { isAssetElement, shouldAutoReload, markReloaded } from "../assetRecovery";

// 外部ブラウザ等で CSS/JS の読み込みに失敗し「壊れたページ」になったとき、
// 1回だけ自動リロードして復旧する仕組みの回帰ガード。

function makeStorage(): Storage {
    const store: Record<string, string> = {};
    return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        key: () => null,
        get length() { return Object.keys(store).length; },
    } as Storage;
}

describe("isAssetElement（リロード対象の判定）", () => {
    it("script の失敗は対象", () => {
        expect(isAssetElement(document.createElement("script"))).toBe(true);
    });
    it("stylesheet link の失敗は対象", () => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        expect(isAssetElement(link)).toBe(true);
    });
    it("stylesheet 以外の link は対象外", () => {
        const link = document.createElement("link");
        link.rel = "icon";
        expect(isAssetElement(link)).toBe(false);
    });
    it("画像の読み込み失敗ではリロードしない（写真の404は正常系にあり得る）", () => {
        expect(isAssetElement(document.createElement("img"))).toBe(false);
    });
    it("window 起因のJSエラー（target無し）は対象外", () => {
        expect(isAssetElement(null)).toBe(false);
        expect(isAssetElement(window)).toBe(false);
    });
});

describe("shouldAutoReload / markReloaded（リロードループ防止）", () => {
    let storage: Storage;
    beforeEach(() => { storage = makeStorage(); });

    it("初回はリロードしてよい", () => {
        expect(shouldAutoReload(1_000_000, storage)).toBe(true);
    });

    it("直後の再失敗ではリロードしない（無限ループ防止）", () => {
        markReloaded(1_000_000, storage);
        expect(shouldAutoReload(1_000_000 + 5_000, storage)).toBe(false);
    });

    it("クールダウン経過後は再びリロードできる", () => {
        markReloaded(1_000_000, storage);
        expect(shouldAutoReload(1_000_000 + 61_000, storage)).toBe(true);
    });

    it("storage が使えない環境ではリロードしない（安全側）", () => {
        expect(shouldAutoReload(1_000_000, null)).toBe(false);
    });
});
