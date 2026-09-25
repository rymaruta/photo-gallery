import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// 動画の進捗バーは timeupdate（仕様上ブラウザ任せ・実測 250ms 間隔）で
// state を更新し、120ms の transition で補間していた。線が「進んでは止まり」を
// 繰り返して見えるうえ、更新のたびにビューア全体が再描画されていた。
// currentTime を毎フレーム読んで transform を直接書く。

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(),
}));

import StoryViewer from "../StoryViewer";

const story = (over: Record<string, unknown>) => ({
    id: "v1", src: "https://cdn/x/a.mp4", userId: "me",
    createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z", ...over,
});
const groupsOf = (item: Record<string, unknown>) =>
    ([{ userId: "me", displayName: "自分", items: [item] }] as unknown as StoryGroup[]);

/** active な進捗バーの transform */
/**
 * **どこまで進んだか**（0〜1）で見る。CSS の綴りでは見ない。
 *
 * 以前は `transform` の文字列をそのまま突き合わせていたが、掴み先が
 * `.origin-left` だった——`scaleX` をやめた日にその class が消え、
 * **セレクタが何も掴まないまま空文字どうしで通る**（＝何も検証しない
 * テストになる）ところだった。進み方という性質で見れば、表現が
 * `scaleX` でも `translateX` でも同じことを確かめ続けられる。
 */
function barRatio(): number | null {
    const bar = document.querySelector<HTMLElement>(".story-progress-video");
    if (!bar) return null;
    const m = /translateX\(([-0-9.]+)%\)/.exec(bar.style.transform);
    return m ? Math.round((1 + Number(m[1]) / 100) * 1e6) / 1e6 : null;
}

const origRaf = globalThis.requestAnimationFrame;
const origCaf = globalThis.cancelAnimationFrame;
let frame: (() => void) | null = null;

beforeEach(() => {
    frame = null;
    // 「次の1回分だけ覚える」rAF。tick() で手動に進める
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        frame = () => cb(0);
        return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => { frame = null; }) as typeof cancelAnimationFrame;
});
afterEach(() => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCaf;
});

function tick() {
    const f = frame;
    frame = null;
    f?.();
}
function setVideoTime(currentTime: number, duration: number | typeof NaN = 10) {
    const v = document.querySelector("video");
    if (!v) throw new Error("video element not found");
    Object.defineProperty(v, "duration", { value: duration, configurable: true });
    Object.defineProperty(v, "currentTime", { value: currentTime, configurable: true });
}
function renderVideoStory() {
    return render(
        <StoryViewer
            groups={groupsOf(story({ mediaType: "video" }))}
            initialGroupIndex={0}
            locale="ja"
            isAuthenticated
            ownUserId="me"
            onSeen={() => { /* noop */ }}
            onClose={() => { /* noop */ }}
        />,
    );
}

describe("動画ストーリーの進捗バー", () => {
    it("timeupdate を待たず、毎フレーム currentTime から書き換える", () => {
        renderVideoStory();
        expect(barRatio()).toBe(0);

        setVideoTime(2.5);   // 10秒中の 2.5秒
        tick();
        expect(barRatio()).toBe(0.25);

        // timeupdate を一度も発火させていないのに、次のフレームで進む
        setVideoTime(7.5);
        tick();
        expect(barRatio()).toBe(0.75);
    });

    it("duration が未確定（NaN）の間は書き換えない", () => {
        renderVideoStory();
        setVideoTime(1, NaN);
        tick();
        expect(barRatio()).toBe(0);
    });

    // 🔴 **`NaN` だけでは門を見たことにならない。** `translateX(NaN%)` は
    // CSS が無効値として捨てるので、門を外しても**バーは動かないまま**＝
    // 観測できない（変異が素通りした）。効きが出るのは **duration が 0** の回で、
    // 門が無いと `0 除算 → Infinity → 1` で**いきなり満杯**に飛ぶ。
    it("duration が 0 の間も書き換えない（0除算で満杯に飛ばさない）", () => {
        renderVideoStory();
        setVideoTime(1, 0);
        tick();
        expect(barRatio()).toBe(0);
    });

    it("currentTime が duration を超えても 1 で止める", () => {
        renderVideoStory();
        setVideoTime(12);
        tick();
        expect(barRatio()).toBe(1);
    });

    it("閉じるとフレームの購読を解除する（裏で回り続けない）", () => {
        const { unmount } = renderVideoStory();
        expect(frame).not.toBeNull();
        unmount();
        expect(frame).toBeNull();
    });
});

describe("画像ストーリーの進捗バー", () => {
    it("CSS アニメーションで駆動する（毎フレームの JS を使わない）", () => {
        render(
            <StoryViewer
                groups={groupsOf(story({ src: "https://cdn/x/a.jpg" }))}
                initialGroupIndex={0}
                locale="ja"
                isAuthenticated
                ownUserId="me"
                onSeen={() => { /* noop */ }}
                onClose={() => { /* noop */ }}
            />,
        );
        const fill = document.querySelector<HTMLElement>(".story-progress-fill");
        expect(fill).not.toBeNull();
        expect(fill!.style.animationDuration).toMatch(/ms$/);
        expect(frame).toBeNull();   // 画像側は rAF を使わない
    });
});
