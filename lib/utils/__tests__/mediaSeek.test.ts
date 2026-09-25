import { describe, it, expect } from "vitest";
import { seekWhenReady } from "../mediaSeek";

/**
 * iOS Safari は、曲の情報を読む前（`readyState` 0）に書いた `currentTime` を
 * 捨てることがある。jsdom の <audio> は読み込みをしないので、捨てる動きを
 * 真似た偽の要素で「情報が届いた時点でもう一度合わせる」ことを確かめる。
 */
function fakeAudio(src: string) {
    const listeners: Record<string, Array<() => void>> = {};
    const el = {
        src, currentSrc: src, readyState: 0, _t: 0,
        get currentTime() { return this._t; },
        // 読む前に書いた値は捨てる（WebKit の振る舞いを真似る）
        set currentTime(v: number) { if (this.readyState >= 1) this._t = v; },
        addEventListener(type: string, fn: () => void) { (listeners[type] ??= []).push(fn); },
        fire(type: string) { for (const fn of listeners[type] ?? []) fn(); listeners[type] = []; },
    };
    return el;
}

describe("seekWhenReady", () => {
    it("読む前に頭出ししても、情報が届いた時点で指定の位置に合う", () => {
        const a = fakeAudio("https://p.test/a.m4a");
        seekWhenReady(a as unknown as HTMLMediaElement, 12);
        expect(a.currentTime).toBe(0); // まだ捨てられている
        a.readyState = 1;
        a.fire("loadedmetadata");
        expect(a.currentTime).toBe(12);
    });

    it("読めているならその場で合わせる", () => {
        const a = fakeAudio("https://p.test/a.m4a");
        a.readyState = 4;
        seekWhenReady(a as unknown as HTMLMediaElement, 7);
        expect(a.currentTime).toBe(7);
    });

    it("情報が届く前に別の曲へ差し替わったら、古い頭出しは当てない", () => {
        const a = fakeAudio("https://p.test/a.m4a");
        seekWhenReady(a as unknown as HTMLMediaElement, 12);
        a.src = a.currentSrc = "https://p.test/b.m4a";
        a.readyState = 1;
        a.fire("loadedmetadata");
        expect(a.currentTime).toBe(0);
    });
});
