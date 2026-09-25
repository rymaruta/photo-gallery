import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// **止める手段が「押しっぱなし」しか無かった。** 読む速さは人によって違うのに、
// 指を離すと進む＝自分で決められない。キーボードだけの人には手段が無い
// （キーは Escape と ← → だけだった）。スペースで止められ、
// **止まっていることが画面で分かる**（モック09 の「一時停止状態」＝
// 中央の丸い印。押すと再開する）。止める入口は右上の「…」の操作シート。

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(),
}));

import StoryViewer from "../StoryViewer";

const groups = [{
    userId: "me", displayName: "自分",
    items: [{
        id: "s1", src: "https://cdn/x/a.jpg", userId: "me", mediaType: "image",
        createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
    }],
}] as unknown as StoryGroup[];

/** 画像の自動送りを駆動している CSS アニメーションの状態 */
const playState = () =>
    document.querySelector<HTMLElement>(".story-progress-fill")?.style.animationPlayState;


/**
 * **絵が出たことにする。**
 *
 * ストーリーは「読み込みが済むまで時間を進めない」ようになった
 * （owner の「3秒目くらいまで真っ黒」への対応）。jsdom は画像を読まないので、
 * 読み終わりを模さないと**開いた直後のまま凍る**。
 * ここが守っているのは進む/止まるの規則で、その前提が1つ増えただけ。
 */
function markMediaLoaded() {
    const el = document.querySelector("img.story-media-in, video.story-media-in");
    if (el) fireEvent.load(el);
}

const renderThenLoad = (ui: React.ReactElement) => {
    const r = render(ui);
    markMediaLoaded();
    return r;
};

const view = () => renderThenLoad(
    <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
);

/** 「動きを減らす」設定を模す（jsdom には matchMedia が無い） */
function setReducedMotion(reduce: boolean) {
    Object.defineProperty(window, "matchMedia", {
        configurable: true, writable: true,
        value: (q: string) => ({ matches: reduce && q.includes("reduced-motion"), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
    });
}

beforeEach(() => { document.body.innerHTML = ""; setReducedMotion(false); });

describe("ストーリーの自動送りを止める", () => {
    it("既定では進む", () => {
        view();
        expect(playState()).toBe("running");
    });

    it("操作シートの「一時停止」で止まり、中央の印を押すと再開する", () => {
        view();
        // 止まっている間は中央に印が出ていない
        expect(screen.queryByLabelText("再生")).toBeNull();
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        fireEvent.click(screen.getByRole("button", { name: "一時停止" }));
        expect(playState()).toBe("paused");
        // モック09 の「一時停止状態」——止まっていることが画面で分かる
        fireEvent.click(screen.getByLabelText("再生"));
        expect(playState()).toBe("running");
        expect(screen.queryByLabelText("再生")).toBeNull();
    });

    // シートの下に印が透けると、押す対象が2つ見える。止めたあとに
    // シートを開き直しても、印は引っ込む
    it("操作シートを開いている間、中央の印は出ない", () => {
        view();
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        fireEvent.click(screen.getByRole("button", { name: "一時停止" }));
        expect(screen.getByLabelText("再生"), "止めたのに印が出ていない").toBeInTheDocument();
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        expect(screen.queryByLabelText("再生"), "シートの下に印が重なっている").toBeNull();
    });

    it("スペースキーでも止まる（キーボードだけの人の唯一の手段）", () => {
        view();
        fireEvent.keyDown(document, { key: " " });
        expect(playState()).toBe("paused");
        fireEvent.keyDown(document, { key: " " });
        expect(playState()).toBe("running");
    });

    /**
     * **止まっていることが読み上げにも届く**（板 `StoryViewerReply.dc.html` が
     * `aria-label="4本中2本目・止まっています"` と書いている）。
     *
     * 画面では中央に印が出るので目で見れば分かるが、読み上げだけの人には
     * 「進んでいるのか止まっているのか」を知る手がかりが1つも無かった。
     */
    it("止めると、進行バーの読み上げ名にも「止まっています」が付く", () => {
        view();
        const row = () => screen.getByRole("progressbar");
        expect(row().getAttribute("aria-label")).toBe("1本中1本目");
        fireEvent.keyDown(document, { key: " " });
        expect(row().getAttribute("aria-label")).toBe("1本中1本目・止まっています");
        fireEvent.keyDown(document, { key: " " });
        expect(row().getAttribute("aria-label")).toBe("1本中1本目");
    });

    // **ボタンで止めたぶんを、指を離したときに再開しない。**
    // 長押しの解除は「長押しで止めたとき」だけ効かせる
    it("シートで止めたあと、画面に触れて離しても止まったまま", () => {
        const { container } = view();
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        fireEvent.click(screen.getByRole("button", { name: "一時停止" }));
        const zone = container.querySelector(".w-1\\/3")!;
        fireEvent.pointerDown(zone, { clientX: 10, clientY: 10 });
        fireEvent.pointerUp(zone);
        expect(playState(), "ボタンで止めたのに指を離して再開している").toBe("paused");
    });

    // 逆向き: 長押しで止めたぶんは、指を離したら今までどおり再開する
    it("長押しで止めたぶんは、指を離すと再開する", () => {
        const { container } = view();
        const zone = container.querySelector(".w-1\\/3")!;
        fireEvent.pointerDown(zone, { clientX: 10, clientY: 10 });
        expect(playState()).toBe("paused");
        fireEvent.pointerUp(zone);
        expect(playState()).toBe("running");
    });

    // **「動きを減らす」設定なら、最初から止めて出す。**
    // 自動送りは「勝手に進む動き」そのもの。ただし進む手段は残す
    // （`animation: none` にすると `onAnimationEnd` が来ず二度と進まない）
    it("動きを減らす設定なら、開いた時点で止まっている", () => {
        setReducedMotion(true);
        view();
        expect(playState()).toBe("paused");
        // 進めなくなってはいけない: 押せば再開する
        fireEvent.click(screen.getByLabelText("再生"));
        expect(playState()).toBe("running");
    });

    it("設定が無ければ、今までどおり進む", () => {
        setReducedMotion(false);
        view();
        expect(playState()).toBe("running");
    });
});

/**
 * 🔴 owner の報告:「ストーリーが3秒目くらいまで、真っ黒になる」
 *
 * 原因は2つ重なっていた:
 *   1. **ストーリーは `src` しか持たない**（写真はサムネ・下地色・ぼかしを
 *      持つのに）ので、落とし終わるまで出せる絵が無い
 *   2. 進捗の CSS アニメーションが**マウントで走り出す**ので、落としている
 *      間も表示時間が減る
 */
describe("絵が出るまで、時間を進めない", () => {
    it("読み込み中は止まっている", () => {
        render(
            <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
        );
        expect(playState(), "真っ黒のまま時間が減っている").toBe("paused");
    });

    it("読み込みが済んだら進む", () => {
        render(
            <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
        );
        markMediaLoaded();
        expect(playState(), "絵が出たのに進まない").toBe("running");
    });

    it("読み込み中でも「読んでいる」と分かる（真っ黒のままにしない）", () => {
        const { container } = render(
            <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
        );
        expect(container.querySelector(".animate-spin"), "何も出ていない").toBeTruthy();
        markMediaLoaded();
        expect(container.querySelector(".animate-spin"), "出たあとも回り続けている").toBeNull();
    });

    /**
     * 🔴 **控えにある画像は、React がハンドラを付ける前に読み終わっている。**
     * `onLoad` だけに頼ると**永久に止まる**——「3秒黒い」を直して
     * 「進まない」を作ることになる（`fa640312` / `24f9df2c` と同じ型）。
     */
    it("開いた時点で読み終わっていても進む（控えにある画像）", () => {
        const proto = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
        const nat = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");
        Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 1080 });
        try {
            render(
                <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
            );
            expect(playState(), "**控えにある画像で永久に止まる**").toBe("running");
        } finally {
            if (proto) Object.defineProperty(HTMLImageElement.prototype, "complete", proto);
            else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
            if (nat) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", nat);
            else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
        }
    });

    /** 出る絵が無いなら待たない（待つと押すまで動かない） */
    it("読み込みに失敗したら、待たずに止まらない", () => {
        const { container } = render(
            <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
        );
        const img = container.querySelector("img.story-media-in")!;
        fireEvent.error(img);
        expect(playState(), "出る絵が無いのに待ち続けている").toBe("running");
    });
});
