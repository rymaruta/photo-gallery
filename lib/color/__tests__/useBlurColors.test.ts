import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

/**
 * **ぼかし画像から色を決め直す仕掛けの見張り。**
 *
 * 守りたいのは「owner が報告した症状が戻らないこと」——
 * 本番39枚のうち**21枚（54%）でタグと中身が食い違い**、「黒」と出ている
 * 16枚のうち**無彩色しか無いのは1枚だけ**だった（`photo-colors`・2026-09-24）。
 * 影が面積を取るので、**無彩色を除いた分布の1位**を先に見る、が肝。
 *
 * ## 復号の道具は jsdom に無い
 *
 * `createImageBitmap` も `OffscreenCanvas` も jsdom は持たないので、
 * **画素をこちらで決められる形**に差し替える。差し替えるのは復号だけで、
 * 色を決める計算（`tallyBuckets`）は本物を通す
 * ——写した規則で測ると、規則を壊しても気づけない。
 *
 * ## 控えはモジュールの中にある
 *
 * `cache` は module スコープなので、**テストごとに `resetModules` して
 * 読み直す**。しないと前のテストの答えが次に効く。
 */

/** いま描かれている画素（RGBA）。差し替えた復号がここへ書く */
let lastPixels: Uint8ClampedArray = new Uint8ClampedArray(0);
/** 復号を何回通ったか（控えが効いているかを見る） */
let decodeCalls = 0;
/** この data URI は復号で投げる */
let throwFor: string | null = null;
/** 非 null の間、復号は `release(uri)` を呼ぶまで返らない（追い越しを作るため） */
let gate: Map<string, () => void> | null = null;
/** その data URI の復号が「待ち」に入るまで待ってから、通す */
const release = async (uri: string) => {
    await waitFor(() => expect(gate?.has(uri), `${uri} がまだ待ちに入っていない`).toBe(true));
    gate!.get(uri)!();
};
/** `fetch` を通った回数。**`createImageBitmap` を消しても残る**ので、
 *  「復号を試みたか」はこちらで数える（stub 自身を消す変異に負けない） */
let fetchCalls = 0;

/** RGB の3つ組から、20x20 ぶんの RGBA を作る（比率で混ぜる） */
function pixels(parts: { rgb: [number, number, number]; count: number }[]): Uint8ClampedArray {
    const total = 20 * 20;
    const out = new Uint8ClampedArray(total * 4);
    let i = 0;
    for (const p of parts) {
        for (let n = 0; n < p.count && i < total; n++, i++) {
            out[i * 4] = p.rgb[0]; out[i * 4 + 1] = p.rgb[1]; out[i * 4 + 2] = p.rgb[2]; out[i * 4 + 3] = 255;
        }
    }
    // 余りは最後の色で埋める（20x20 に満たないと `tallyBuckets` の分母がずれる）
    const last = parts[parts.length - 1]?.rgb ?? [0, 0, 0];
    for (; i < total; i++) {
        out[i * 4] = last[0]; out[i * 4 + 1] = last[1]; out[i * 4 + 2] = last[2]; out[i * 4 + 3] = 255;
    }
    return out;
}

/** data URI → 画素、の対応表。復号の差し替えがこれを引く */
let table = new Map<string, Uint8ClampedArray>();

function installDecoder() {
    vi.stubGlobal("fetch", vi.fn(async (uri: string) => { fetchCalls++; return { blob: async () => ({ uri }) }; }));
    vi.stubGlobal("createImageBitmap", vi.fn(async (blob: { uri: string }) => {
        decodeCalls++;
        if (throwFor !== null && blob.uri === throwFor) throw new Error("decode failed");
        if (gate) await new Promise<void>((r) => gate!.set(blob.uri, r));
        return { uri: blob.uri, close: () => {} };
    }));
    vi.stubGlobal("OffscreenCanvas", class {
        getContext() {
            return {
                drawImage: (bmp: { uri: string }) => {
                    lastPixels = table.get(bmp.uri) ?? new Uint8ClampedArray(20 * 20 * 4);
                },
                getImageData: () => ({ data: lastPixels }),
            };
        }
    });
}

async function load() {
    vi.resetModules();
    return (await import("../useBlurColors")).useBlurColors;
}

beforeEach(() => {
    decodeCalls = 0;
    fetchCalls = 0;
    throwFor = null;
    gate = null;
    table = new Map();
    installDecoder();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** 影（ほぼ真っ黒）が大多数・橙が少数。本番でいちばん多かった形 */
const SHADOW_HEAVY = pixels([
    { rgb: [250, 140, 30], count: 60 },   // 橙 60画素
    { rgb: [8, 8, 8], count: 340 },       // ほぼ真っ黒 340画素
]);
/** 本当に無彩色しか無い写真（白鳥と湖の側） */
const ACHROMATIC_ONLY = pixels([{ rgb: [20, 20, 20], count: 400 }]);

describe("色の決め方", () => {
    it("🔴 影が面積の大多数でも、主題の色（橙）を返す", async () => {
        table.set("u1", SHADOW_HEAVY);
        const useBlurColors = await load();
        const photos = [{ id: "p1", blurDataURL: "u1" }];
        const { result } = renderHook(() => useBlurColors(photos));
        await waitFor(() => expect(result.current.get("p1")).toBe("orange"));
    });

    it("無彩色しか無い写真は、除かない分布の1位（黒）を返す", async () => {
        table.set("u1", ACHROMATIC_ONLY);
        const useBlurColors = await load();
        const photos = [{ id: "p1", blurDataURL: "u1" }];
        const { result } = renderHook(() => useBlurColors(photos));
        await waitFor(() => expect(result.current.get("p1")).toBe("black"));
    });

    it("ぼかしを持たない写真は入らない", async () => {
        const useBlurColors = await load();
        const photos = [{ id: "p1" }, { id: "p2", blurDataURL: "" }];
        const { result } = renderHook(() => useBlurColors(photos));
        await waitFor(() => expect(decodeCalls).toBe(0));
        expect(result.current.size).toBe(0);
    });

    it("復号が落ちた写真だけ抜け、他は入る", async () => {
        table.set("ok", SHADOW_HEAVY);
        throwFor = "bad";
        const useBlurColors = await load();
        const photos = [{ id: "bad", blurDataURL: "bad" }, { id: "ok", blurDataURL: "ok" }];
        const { result } = renderHook(() => useBlurColors(photos));
        await waitFor(() => expect(result.current.get("ok")).toBe("orange"));
        expect(result.current.has("bad")).toBe(false);
    });
});

describe("控え", () => {
    it("同じ data URI は二度復号しない", async () => {
        table.set("same", SHADOW_HEAVY);
        const useBlurColors = await load();
        const photos = [
            { id: "p1", blurDataURL: "same" },
            { id: "p2", blurDataURL: "same" },
            { id: "p3", blurDataURL: "same" },
        ];
        const { result } = renderHook(() => useBlurColors(photos));
        await waitFor(() => expect(result.current.size).toBe(3));
        expect(decodeCalls, "同じぼかしを復号し直している").toBe(1);
    });
});

describe("復号できない環境", () => {
    it("`createImageBitmap` が無ければ、何もせず空の Map", async () => {
        vi.stubGlobal("createImageBitmap", undefined);
        const useBlurColors = await load();
        const photos = [{ id: "p1", blurDataURL: "u1" }];
        const { result } = renderHook(() => useBlurColors(photos));
        await new Promise((r) => setTimeout(r, 0));
        expect(result.current.size).toBe(0);
        expect(fetchCalls, "復号できない環境なのに取りに行っている").toBe(0);
    });

    it("`OffscreenCanvas` が無ければ、何もせず空の Map", async () => {
        vi.stubGlobal("OffscreenCanvas", undefined);
        const useBlurColors = await load();
        const photos = [{ id: "p1", blurDataURL: "u1" }];
        const { result } = renderHook(() => useBlurColors(photos));
        await new Promise((r) => setTimeout(r, 0));
        expect(result.current.size).toBe(0);
        expect(fetchCalls, "復号できない環境なのに取りに行っている").toBe(0);
    });
});

describe("後始末", () => {
    it("外したあとに書き込まない（React の警告を出さない）", async () => {
        table.set("u1", SHADOW_HEAVY);
        const useBlurColors = await load();
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const photos = [{ id: "p1", blurDataURL: "u1" }];
        const { unmount } = renderHook(() => useBlurColors(photos));
        unmount();
        await new Promise((r) => setTimeout(r, 10));
        expect(err).not.toHaveBeenCalled();
        err.mockRestore();
    });

    /**
     * **一覧が入れ替わると、前の実行はまだ復号の途中にいる。**
     * 追い越された側が最後に書くと、いま描いている一覧と違う色が出る
     * （`useMyPhotoIdList` が世代で捨てているのと同じ形）。
     */
    it("追い越された実行は、あとから書き込まない", async () => {
        table.set("slow", pixels([{ rgb: [40, 200, 80], count: 400 }]));   // 緑
        table.set("fast", pixels([{ rgb: [250, 140, 30], count: 400 }]));  // 橙
        gate = new Map();
        const useBlurColors = await load();
        const { result, rerender } = renderHook(
            ({ photos }) => useBlurColors(photos),
            { initialProps: { photos: [{ id: "p", blurDataURL: "slow" }] } },
        );
        // まだ復号の途中で、新しい一覧に入れ替わる
        rerender({ photos: [{ id: "p", blurDataURL: "fast" }] });
        await release("fast");
        await waitFor(() => expect(result.current.get("p")).toBe("orange"));
        // 追い越された側がいま返ってくる
        await release("slow");
        await new Promise((r) => setTimeout(r, 10));
        expect(result.current.get("p"), "古い実行が新しい色を上書きした").toBe("orange");
    });

    /**
     * 1枚も決まらないときに `setState` すると、**毎回 新しい Map になって
     * 描き直しが1回増える**（呼ぶ側の `useMemo` も作り直す）。
     */
    it("1枚も決まらなければ描き直さない", async () => {
        const useBlurColors = await load();
        let renders = 0;
        const photos = [{ id: "p1" }, { id: "p2" }];
        renderHook(() => { renders++; return useBlurColors(photos); });
        await new Promise((r) => setTimeout(r, 10));
        expect(renders, "色が1つも決まらないのに描き直している").toBe(1);
    });
});
