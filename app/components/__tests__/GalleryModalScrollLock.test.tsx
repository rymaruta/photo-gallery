import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// **写真を送るたびに、スクロールロックを全解除して取り直していた。**
//
// ロックは `[onClose, onNext, onPrev]` を deps に持つエフェクトに同居して
// いた。`GalleryPageClient` の `handleClose` は `openPhotoId` に依存する
// ので、**送るたびに参照が変わる**＝毎回 unlock → lock。解除は
// `position: fixed` を外して `window.scrollTo` を撃つところまでやるので、
// 送るたびにスクロール位置を控え直すことになる——高さが変わっていれば
// `scrollTo` はクランプされ、控えが少しずつずれて「閉じたら違う場所に
// 戻る」に化ける。ロックの寿命は「開いている間」で、コールバックの
// 同一性とは関係が無い。

vi.mock("../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ likes: 0 }) })),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import GalleryModal from "../GalleryModal";
import type { Photo } from "@/lib/data/photos";

const photos: Photo[] = [
    { id: "p1", src: "https://cdn/p1.jpg", title: { ja: "1枚目", en: "1" }, tags: [] },
    { id: "p2", src: "https://cdn/p2.jpg", title: { ja: "2枚目", en: "2" }, tags: [] },
];

let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
    localStorage.clear();
    scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { value: scrollTo, writable: true, configurable: true });
});

function view(index: number, onClose: () => void) {
    return (
        <GalleryModal photos={photos} currentIndex={index} onClose={onClose}
            onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />
    );
}

describe("GalleryModal のスクロールロック", () => {
    it("写真を送っても解除し直さない（閉じるまで掛けたまま）", () => {
        const { rerender } = render(view(0, vi.fn()));
        expect(document.body.style.position).toBe("fixed");

        // 送る＝ index が変わり、handleClose の参照も変わる
        rerender(view(1, vi.fn()));
        rerender(view(0, vi.fn()));

        expect(scrollTo, "開いている間にスクロール位置を戻している").not.toHaveBeenCalled();
        expect(document.body.style.position, "ロックが外れている").toBe("fixed");
    });

    it("閉じたら解除する（位置も戻す）", () => {
        const { unmount } = render(view(0, vi.fn()));
        unmount();

        expect(document.body.style.position).toBe("");
        expect(document.body.style.overflow).toBe("");
        expect(scrollTo, "閉じたのに位置を戻していない").toHaveBeenCalled();
    });
});
