import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

/**
 * 最終版モック09 ⑤「ジェスチャー操作」。
 *
 *   左右のスワイプ … 前後のストーリーへ
 *   下へスワイプ  … 閉じる
 *   上へスワイプ  … 操作シート
 *
 * これまでは**タップだけ**で、払っても何も起きなかった（指を離した場所で
 * `click` が起きるので、払ったつもりが「送り」になることもあった）。
 *
 * **払ったと決めたら、そのあとの `click` は無かったことにする**
 * ——残すと同じ操作で2回送られる（1枚飛ばす）。
 */

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(),
    readApiError: async (_r: unknown, f: string) => f,
    sessionErrorMessage: () => null,
}));

import StoryViewer from "../StoryViewer";

const groups: StoryGroup[] = [{
    userId: "friend", displayName: "友人",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "friend", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" },
        { id: "s2", src: "https://cdn/x/b.jpg", userId: "friend", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z" },
        { id: "s3", src: "https://cdn/x/c.jpg", userId: "friend", createdAt: "2026-07-04T12:00:00Z", expiresAt: "2099-07-05T12:00:00Z" },
    ],
}];

const view = (initialItemIndex = 1) => {
    const onClose = vi.fn();
    const r = render(
        <StoryViewer groups={groups} initialGroupIndex={0} initialItemIndex={initialItemIndex}
            locale="ja" isAuthenticated ownUserId="me"
            onSeen={() => { /* noop */ }} onClose={onClose} />,
    );
    const el = document.querySelector("img.story-media-in");
    if (el) fireEvent.load(el);
    return { ...r, onClose };
};
const shown = () => document.querySelector("img.story-media-in")?.getAttribute("src") ?? "";
/** 左のタップ領域（払う場所はどちらでも同じ判定） */
const zone = (c: HTMLElement) => c.querySelector(".w-1\\/3") as HTMLElement;

/**
 * 実際の指の動き: 押す → 離す → `click`。
 * ブラウザは払ったあとも `click` を投げるので、**そこまで再現する**
 * （ここを省くと「二重に送る」回帰を見逃す）。
 */
const swipe = (el: HTMLElement, dx: number, dy: number) => {
    fireEvent.pointerDown(el, { clientX: 200, clientY: 400 });
    fireEvent.pointerUp(el, { clientX: 200 + dx, clientY: 400 + dy });
    fireEvent.click(el, { clientX: 200 + dx, clientY: 400 + dy });
};

beforeEach(() => { vi.clearAllMocks(); });

describe("左右のスワイプ（モック⑤）", () => {
    it("左へ払うと次の1枚（1枚だけ進む）", () => {
        const { container } = view();
        swipe(zone(container), -120, 10);
        expect(shown(), "1枚飛ばしている（払いと click で2回送っている）").toContain("c.jpg");
    });

    it("右へ払うと前の1枚", () => {
        const { container } = view();
        swipe(zone(container), 120, -10);
        expect(shown()).toContain("a.jpg");
    });

    it("少しの動きは今までどおりタップ（左は前へ）", () => {
        const { container } = view();
        swipe(zone(container), 5, 3);
        expect(shown()).toContain("a.jpg");
    });
});

describe("払ったあとのタップ", () => {
    // **払いの印は押し始めで戻す。** 戻さないと、一度払ったあとの
    // タップがすべて無視される（送りが効かなくなる）
    it("払った次のタップは今までどおり効く", () => {
        const { container } = view();
        swipe(zone(container), -120, 0);      // 次へ（c.jpg）
        expect(shown()).toContain("c.jpg");
        // 続けて左を短くタップ＝前へ
        swipe(zone(container), 2, 2);
        expect(shown(), "払ったあとのタップが無視されている").toContain("b.jpg");
    });
});

describe("上下のスワイプ（モック⑤）", () => {
    it("下へ払うと閉じる", () => {
        const { container, onClose } = view();
        swipe(zone(container), 0, 120);
        expect(onClose).toHaveBeenCalled();
    });

    it("上へ払うと操作シートが出る", async () => {
        const { container } = view();
        swipe(zone(container), 0, -120);
        expect(await screen.findByRole("button", { name: "一時停止" })).toBeInTheDocument();
    });

    // 閉じるのは戻れない操作。指の揺れで閉じない
    it("わずかな縦の揺れでは閉じない", () => {
        const { container, onClose } = view();
        swipe(zone(container), 0, 40);
        expect(onClose).not.toHaveBeenCalled();
    });

    // 斜めに払ったときに、送りと閉じるが取り合わない
    it("横優位の斜めは送りになる（閉じない）", async () => {
        const { container, onClose } = view();
        swipe(zone(container), -150, 60);
        expect(onClose).not.toHaveBeenCalled();
        await waitFor(() => expect(shown()).toContain("c.jpg"));
    });
});
