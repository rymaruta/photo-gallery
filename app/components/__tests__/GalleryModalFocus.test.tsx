import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FOCUSABLE } from "../../../lib/hooks/useFocusTrap";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **今の挙動を写し取るテスト。**
//
// GalleryModal は自前のフォーカストラップを持っている（`useFocusTrap` を
// 作る前からある）。守っているテストが2本（いいねの POST/DELETE）しか無く、
// 置き換えると壊しても気づけない状態だった。移す前に、まず今の振る舞いを
// ここに固定する。**移すかどうかはこのテストが通るかで決める。**

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { resetFavoritesCache } from "../../../lib/hooks/useFavorites";
import GalleryModal from "../GalleryModal";
import type { Photo } from "@/lib/data/photos";

const photo = (id: string): Photo => ({
    id, src: `https://cdn.example.com/uploads/u1/${id}.jpg`,
    title: { ja: "写真", en: "Photo" }, tags: [], likes: 3,
});

beforeEach(() => {
    localStorage.clear();
    resetFavoritesCache();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 3 }) });
    mockUserFetch.mockReset().mockImplementation((path: string) =>
        Promise.resolve(path.startsWith("/user/likes/")
            ? { ok: true, json: async () => ({ liked: false }) }
            : { ok: true, json: async () => ({ likes: 4 }) }));
});
afterEach(() => { localStorage.clear(); });

const onClose = vi.fn();
const onNext = vi.fn();
const onPrev = vi.fn();

function setup() {
    const utils = render(
        <div>
            <button>裏のボタン</button>
            <GalleryModal
                photos={[photo("p1"), photo("p2")]}
                currentIndex={0}
                onClose={onClose} onNext={onNext} onPrev={onPrev}
                locale="ja"
            />
        </div>,
    );
    return utils;
}

describe("GalleryModal: 今のフォーカスの挙動", () => {
    beforeEach(() => { onClose.mockReset(); onNext.mockReset(); onPrev.mockReset(); });

    // 移す前は 100ms のタイマーで当てていた。**待たずに当てる**ように
    // 変えたので、テストも同期で見る——`waitFor` のままだと、遅延を
    // 戻す変異が通ってしまう（実際に確かめた）。名前も直した。
    it("開いた時点で「前へ」ボタンにフォーカスが入る", () => {
        setup();
        expect(document.activeElement).toBe(screen.getByLabelText("前の写真"));
    });

    it("閉じたら開く前の要素へフォーカスを戻す", async () => {
        const back = document.createElement("button");
        back.textContent = "起動元";
        document.body.appendChild(back);
        back.focus();

        const { unmount } = setup();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("前の写真")));
        unmount();
        expect(document.activeElement).toBe(back);
        back.remove();
    });

    it("Escape で閉じる", async () => {
        setup();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("矢印キーで前後に動く", () => {
        setup();
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(onNext).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        expect(onPrev).toHaveBeenCalledTimes(1);
    });

    // ? でキーボードヘルプ。開いている間は Escape がヘルプだけを閉じる
    it("ヘルプが開いていたら、Escape はヘルプだけを閉じる", async () => {
        setup();
        fireEvent.keyDown(window, { key: "?" });
        await screen.findByRole("dialog", { name: /キーボード|Keyboard/ }).catch(() => null);
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
        // もう一度で本体が閉じる
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("最後の要素から Tab すると先頭へ戻る（外へ出さない）", async () => {
        setup();
        const modal = document.querySelector('[role="dialog"]') as HTMLElement;
        const items = Array.from(modal.querySelectorAll<HTMLElement>(
            FOCUSABLE));
        expect(items.length).toBeGreaterThan(1);

        items[items.length - 1].focus();
        // **document に投げる。** document → window と伝わるので、
        // 購読先が window でも document でも届く（実装に依存しない）。
        // window に投げると window の購読しか動かない
        fireEvent.keyDown(document, { key: "Tab" });
        expect(document.activeElement).toBe(items[0]);
    });

    it("先頭から Shift+Tab すると最後へ回る", async () => {
        setup();
        const modal = document.querySelector('[role="dialog"]') as HTMLElement;
        const items = Array.from(modal.querySelectorAll<HTMLElement>(
            FOCUSABLE));
        items[0].focus();
        fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
        expect(document.activeElement).toBe(items[items.length - 1]);
    });
});

/**
 * **同意画面（優先度のある閉じ込め）が上にある間、裏の拡大表示のキー操作は効かない。**
 * 共有リンクの拡大表示の上に「はじめる前に」が出ていると、`h` で見えない写真に
 * いいねが付き、矢印で見えない写真がめくられ、Escape で裏が閉じていた。
 */
import { useFocusTrap as useTrapForGate } from "../../../lib/hooks/useFocusTrap";
function GateLike() {
    const ref = React.useRef<HTMLDivElement | null>(null);
    useTrapForGate(true, ref, undefined, undefined, 1);
    return <div ref={ref} role="dialog" aria-label="はじめる前に"><button>同意してはじめる</button></div>;
}

describe("GalleryModal: 同意画面の裏では、キー操作を受けない", () => {
    beforeEach(() => { onClose.mockReset(); onNext.mockReset(); onPrev.mockReset(); });

    it("h・矢印・Escape が裏の写真に効かない", async () => {
        render(
            <div>
                <GalleryModal photos={[photo("p1"), photo("p2")]} currentIndex={0}
                    onClose={onClose} onNext={onNext} onPrev={onPrev} locale="ja" />
                <GateLike />
            </div>,
        );
        fireEvent.keyDown(window, { key: "h" });
        fireEvent.keyDown(window, { key: "ArrowRight" });
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        fireEvent.keyDown(window, { key: "Escape" });
        // 書き込み（POST・DELETE）だけを数える。開いたときの状態の読み出しは数えない
        await new Promise((r) => setTimeout(r, 20));
        const writes = mockUserFetch.mock.calls.filter((c) =>
            ["POST", "DELETE", "PUT"].includes(String((c[1] as { method?: string } | undefined)?.method ?? "")));
        expect(writes, "同意画面の裏でいいねが送られた").toEqual([]);
        expect(onNext).not.toHaveBeenCalled();
        expect(onPrev).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it("同意画面が無ければ、今までどおり効く（見張りが空振りしていない）", () => {
        setup();
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(onNext).toHaveBeenCalled();
    });
});
