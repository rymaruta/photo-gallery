import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

/**
 * iPhone でだけ起きるストーリーの不具合（docs/ios-bug-audit-2026-09-25.md #3・#5・#41・#48）。
 *
 * iOS は「タップで音を出してよいと許した」ことを**要素ごと**に覚える。
 * jsdom にその方針は無いので、「要素を作り直していない」「断られたら消音で
 * 鳴らし直す」という形で見る。
 */

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
    readApiError: async (_res: unknown, fallback: string) => fallback,
    sessionErrorMessage: () => null,
}));

import StoryViewer from "../StoryViewer";

const SONG = "https://audio-ssl.itunes.apple.com/p.m4a";
const item = (id: string, over: Record<string, unknown> = {}) => ({
    id, src: `https://cdn/x/${id}.jpg`, userId: "friend", mediaType: "image",
    createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
    ...over,
});
const groups = (items: unknown[]) => [{ userId: "friend", displayName: "友人", items }] as unknown as StoryGroup[];

const view = (items: unknown[]) => {
    const r = render(
        <StoryViewer groups={groups(items)} initialGroupIndex={0} locale="ja"
            isAuthenticated ownUserId="me" onSeen={vi.fn()} onClose={vi.fn()} />,
    );
    const el = document.querySelector("img.story-media-in, video.story-media-in");
    if (el) { fireEvent.load(el); fireEvent.loadedData(el); }
    return r;
};

let playImpl: (this: HTMLMediaElement) => Promise<void>;
beforeEach(() => {
    playImpl = () => Promise.resolve();
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true, writable: true, value: function (this: HTMLMediaElement) { return playImpl.call(this); },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
        configurable: true, writable: true, value: () => { /* noop */ },
    });
});

describe("#3 自動で次へ進んでも BGM が鳴る", () => {
    it("ストーリーをまたいで同じ <audio> を使い回す（作り直すと iOS の許可が切れる）", () => {
        view([item("s1", { song: { title: "曲1", previewUrl: SONG } }), item("s2", { song: { title: "曲2", previewUrl: SONG } })]);
        const first = document.querySelector("audio");
        expect(first).not.toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "次のストーリー" }));
        const second = document.querySelector("audio");
        expect(second, "次のストーリーで <audio> を作り直している").toBe(first);
    });

    it("曲の無いストーリーに移ったら音源を外す", () => {
        view([item("s1", { song: { title: "曲1", previewUrl: SONG } }), item("s2")]);
        expect(document.querySelector("audio")?.getAttribute("src")).toBe(SONG);
        fireEvent.click(screen.getByRole("button", { name: "次のストーリー" }));
        expect(document.querySelector("audio")?.hasAttribute("src")).toBe(false);
    });

    it("音ありの自動再生を断られた動画は、消音で鳴らし直す（止まったまま進まなくならない）", async () => {
        const calls: boolean[] = [];
        // iOS の方針を真似る: タップの中で音を許した要素（1本目）は鳴らせる。
        // 新しく作った要素（2本目）は、音ありだと断られる
        playImpl = function (this: HTMLMediaElement) {
            if (this.tagName !== "VIDEO" || !this.getAttribute("src")?.includes("v2")) return Promise.resolve();
            calls.push(this.muted);
            if (!this.muted) {
                const e = new Error("not allowed"); e.name = "NotAllowedError";
                return Promise.reject(e);
            }
            return Promise.resolve();
        };
        view([
            item("v1", { mediaType: "video", src: "https://cdn/x/v1.mp4" }),
            item("v2", { mediaType: "video", src: "https://cdn/x/v2.mp4" }),
        ]);
        // 1本目で音をオンにする（シートの「ミュート解除」）
        fireEvent.click(screen.getByRole("button", { name: /その他|メニュー|操作/ }));
        fireEvent.click(screen.getByRole("button", { name: "ミュート解除" }));
        // 2本目へ（新しい <video> が音ありで自動再生を試みる → iOS は断る）
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "次のストーリー" })); });
        const v2 = document.querySelector("video")!;
        await act(async () => { fireEvent.loadedData(v2); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
        expect(calls[0], "音ありで試していない（前提が崩れている）").toBe(false);
        expect(calls, "断られたあと消音で鳴らし直していない").toContain(true);
        expect(v2.muted).toBe(true);
    });
});

describe("#3 鳴らし直しの途中で止めた・送ったときは一時停止にしない", () => {
    const twoVideos = () => [
        item("v1", { mediaType: "video", src: "https://cdn/x/v1.mp4" }),
        item("v2", { mediaType: "video", src: "https://cdn/x/v2.mp4" }),
        item("i3"),
    ];
    const reject = (name: string) => { const e = new Error(name); e.name = name; return Promise.reject(e); };

    it("消音の鳴らし直しが AbortError（シートを開いた・送った）で失敗しても「再生」を出さない", async () => {
        playImpl = function (this: HTMLMediaElement) {
            if (this.tagName !== "VIDEO" || !this.getAttribute("src")?.includes("v2")) return Promise.resolve();
            return this.muted ? reject("AbortError") : reject("NotAllowedError");
        };
        view(twoVideos());
        fireEvent.click(screen.getByRole("button", { name: /その他|メニュー|操作/ }));
        fireEvent.click(screen.getByRole("button", { name: "ミュート解除" }));
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "次のストーリー" })); });
        await act(async () => { fireEvent.loadedData(document.querySelector("video")!); });
        await act(async () => { for (let k = 0; k < 5; k++) await Promise.resolve(); });
        expect(screen.queryByRole("button", { name: "再生" }), "中断を「断られた」と読んで止めた").toBeNull();
    });

    it("消音でも断られて止めたのは、送ったら解く（先の画像まで止まったままにしない）", async () => {
        playImpl = function (this: HTMLMediaElement) {
            if (this.tagName !== "VIDEO" || !this.getAttribute("src")?.includes("v2")) return Promise.resolve();
            return reject("NotAllowedError");
        };
        view(twoVideos());
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "次のストーリー" })); });
        await act(async () => { fireEvent.loadedData(document.querySelector("video")!); });
        await act(async () => { for (let k = 0; k < 5; k++) await Promise.resolve(); });
        expect(screen.getByRole("button", { name: "再生" }), "低電力モードの前提が作れていない").toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "次のストーリー" })); });
        expect(screen.queryByRole("button", { name: "再生" }), "画像まで止まったまま").toBeNull();
    });
});

describe("#3 自動再生の一時停止の印（レビューで見張りが無いと指摘された2点）", () => {
    const reject = () => { const e = new Error("x"); e.name = "NotAllowedError"; return Promise.reject(e); };

    it("自分で再開したあとに自分で止めた一時停止は、送っても解かない", async () => {
        // タップで「再生」を押すまでは断られ、押したあとは通る（iOS はタップで許す）
        let unlocked = false;
        playImpl = function (this: HTMLMediaElement) {
            if (this.tagName !== "VIDEO" || !this.getAttribute("src")?.includes("v2")) return Promise.resolve();
            return unlocked ? Promise.resolve() : reject();
        };
        view([
            item("v1", { mediaType: "video", src: "https://cdn/x/v1.mp4" }),
            item("v2", { mediaType: "video", src: "https://cdn/x/v2.mp4" }),
            item("i3"), item("i4"),
        ]);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "次のストーリー" })); });
        await act(async () => { fireEvent.loadedData(document.querySelector("video")!); });
        await act(async () => { for (let k = 0; k < 5; k++) await Promise.resolve(); });
        // 自動再生を断られて止まった → 同じストーリーで自分で再開 → 自分で止める → 送る
        unlocked = true;
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "再生" })); });
        expect(screen.queryByRole("button", { name: "再生" }), "再開できていない（前提）").toBeNull();
        await act(async () => { fireEvent.keyDown(document, { key: " " }); });
        expect(screen.getByRole("button", { name: "再生" }), "自分で止められていない（前提）").toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "次のストーリー" })); });
        expect(screen.queryByRole("button", { name: "再生" }), "自分で止めたのに、送ったら解かれた").toBeTruthy();
    });

    it("曲付きの画像で消音の自動再生まで断られても、「音を出す」を押せばそのタップの中で鳴らす", async () => {
        const audioCalls: boolean[] = [];
        playImpl = function (this: HTMLMediaElement) {
            if (this.tagName !== "AUDIO") return Promise.resolve();
            audioCalls.push(this.muted);
            // 低電力モード: 操作の外では消音でも断る。操作の中（muted を外した直後）は通す
            return this.muted ? reject() : Promise.resolve();
        };
        view([item("s1", { song: { title: "曲1", previewUrl: SONG } })]);
        await act(async () => { for (let k = 0; k < 5; k++) await Promise.resolve(); });
        expect(audioCalls, "前提: 自動で鳴らそうとしていない").toContain(true);
        audioCalls.length = 0;
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "音を出す" })); });
        expect(audioCalls, "「音を出す」を押しても鳴らしていない").toContain(false);
    });
});

describe("#5 上下の払い", () => {
    it("タップ領域はブラウザに指の動きを取らせない（取られると pointercancel で払いが消える）", () => {
        view([item("s1")]);
        const zones = [...document.querySelectorAll<HTMLElement>("div.absolute.z-10")].filter((z) => z.style.top === "80px");
        expect(zones).toHaveLength(2);
        // pan を許すとブラウザが指を取る。ピンチでの拡大は残す（弱視の人が拡大できるように）
        for (const z of zones) expect(z.style.touchAction).toBe("pinch-zoom");
    });

    it("pointercancel が来たら押し始めを捨て、長押しの一時停止も解く", () => {
        view([item("s1")]);
        const zone = [...document.querySelectorAll<HTMLElement>("div.absolute.z-10")].find((z) => z.style.top === "80px")!;
        fireEvent.pointerDown(zone, { clientX: 10, clientY: 300 });
        fireEvent.pointerCancel(zone);
        // 止まったままなら「再生」ボタンが出ている
        expect(screen.queryByRole("button", { name: "再生" }), "長押しの一時停止が残った").toBeNull();
    });
});

describe("#41 VoiceOver から前後に送れる", () => {
    it("「前のストーリー」「次のストーリー」のボタンがあり、押すと送れる", () => {
        view([item("s1", { caption: "一枚目" }), item("s2", { caption: "二枚目" })]);
        expect(screen.getByRole("button", { name: "前のストーリー" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "次のストーリー" }));
        expect(screen.getAllByText("二枚目").length).toBeGreaterThan(0);
    });
});

describe("#48 操作シートがダイアログと名乗る", () => {
    it("「…」のシートは role=dialog・aria-modal・名前を持つ", () => {
        view([item("s1")]);
        fireEvent.click(screen.getByRole("button", { name: /その他|メニュー|操作/ }));
        const d = screen.getByRole("dialog", { name: "ストーリーの操作" });
        expect(d.getAttribute("aria-modal")).toBe("true");
    });
});
