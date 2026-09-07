import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GalleryGrid, { GRID_INITIAL_VISIBLE, GRID_STEP } from "../GalleryGrid";
import PHOTOS_JSON from "../../data/photos.json";
import type { Photo } from "@/lib/data/photos";

// ビルド時の photos.json に居る写真は /photo/<id> の静的ページを持つ。
// 居ない写真（ビルド後の新着）は静的ページが無いので /?photo=<id> になり、
// ホームのモーダルだけが閲覧手段になる。
const BUILT_ID = (PHOTOS_JSON as Array<{ id: string }>)[0].id;
const NEW_ID = "brand-new-photo-id";

const photo = (id: string): Photo => ({
    id,
    src: `https://cdn.example.com/uploads/${id}.jpg`,
    title: { ja: "写真", en: "Photo" },
    tags: [],
});

function setup(ids: string[], onOpenPhoto?: (id: string) => boolean) {
    render(<GalleryGrid photos={ids.map(photo)} locale="ja" onOpenPhoto={onOpenPhoto} />);
}

describe("GalleryGrid: 新着写真のタップ", () => {
    it("静的ページの無い写真は /?photo= を指す", () => {
        setup([NEW_ID]);
        expect(screen.getByRole("link")).toHaveAttribute("href", `/?photo=${NEW_ID}`);
    });

    it("ホームでは遷移せずその場でモーダルを開く", () => {
        // /?photo= は「今いるURL」なので、Next のルーターは何もしない。
        // 以前はそのせいで新着写真をタップしても無反応だった
        // （新着写真にとっては唯一の閲覧手段なのに）。
        const onOpenPhoto = vi.fn().mockReturnValue(true);
        setup([NEW_ID], onOpenPhoto);
        const link = screen.getByRole("link");
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(link, ev);
        expect(onOpenPhoto).toHaveBeenCalledWith(NEW_ID);
        expect(ev.defaultPrevented).toBe(true);
    });

    it("静的ページのある写真はそのまま個別ページへ遷移させる", () => {
        const onOpenPhoto = vi.fn().mockReturnValue(true);
        setup([BUILT_ID], onOpenPhoto);
        const link = screen.getByRole("link");
        expect(link).toHaveAttribute("href", `/photo/${BUILT_ID}`);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(link, ev);
        expect(onOpenPhoto).not.toHaveBeenCalled();
        expect(ev.defaultPrevented).toBe(false);
    });

    it("新しいタブで開く操作（⌘/Ctrl+クリック）は邪魔しない", () => {
        const onOpenPhoto = vi.fn().mockReturnValue(true);
        setup([NEW_ID], onOpenPhoto);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
        fireEvent(screen.getByRole("link"), ev);
        expect(onOpenPhoto).not.toHaveBeenCalled();
        expect(ev.defaultPrevented).toBe(false);
    });

    it("ホーム以外（onOpenPhoto なし）では通常の遷移のまま", () => {
        setup([NEW_ID]);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(screen.getByRole("link"), ev);
        expect(ev.defaultPrevented).toBe(false);
    });
});

// **一覧は全部を一度に DOM へ置いていた。** 枚数に比例して重くなり、
// Chromium 実測（390x844・CPU 4倍遅い）で 1,000枚 → 2.7秒、3,000枚 → 8.8秒の
// 「何も反応しない時間」が出ていた。下端に近づいたぶんだけ足す
describe("GalleryGrid: 枚数が増えても一度に全部は描かない", () => {
    const many = (n: number): Photo[] => Array.from({ length: n }, (_, i) => ({
        id: `p${i}`, src: `https://cdn/${i}.jpg`, userId: "u1", title: `写真${i}`, published: true,
    } as Photo));

    /** IntersectionObserver を差し替えて、番兵が見えたことにする */
    function stubObserver() {
        const instances: Array<{ cb: IntersectionObserverCallback; el: Element | null }> = [];
        class IO {
            cb: IntersectionObserverCallback;
            el: Element | null = null;
            constructor(cb: IntersectionObserverCallback) { this.cb = cb; instances.push(this); }
            observe(el: Element) { this.el = el; }
            disconnect() { /* noop */ }
            unobserve() { /* noop */ }
            takeRecords() { return []; }
            root = null; rootMargin = ""; thresholds = [];
        }
        (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
        return {
            instances,
            /** いちばん新しい観測者に「見えた」と伝える */
            fire: () => {
                const io = instances[instances.length - 1];
                act(() => io.cb([{ isIntersecting: true } as IntersectionObserverEntry], io as unknown as IntersectionObserver));
            },
        };
    }
    const cards = (c: HTMLElement) => c.querySelectorAll("[data-photo-id]").length;

    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).IntersectionObserver;
    });

    it("最初は先頭ぶんだけ描く", () => {
        stubObserver();
        const { container } = render(<GalleryGrid photos={many(500)} locale="ja" />);
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE);
    });

    it("枚数が少なければ何も変わらない（今の30枚はこちら）", () => {
        stubObserver();
        const { container } = render(<GalleryGrid photos={many(30)} locale="ja" />);
        expect(cards(container)).toBe(30);
    });

    it("下端が近づくたびに足す", () => {
        const io = stubObserver();
        const { container } = render(<GalleryGrid photos={many(500)} locale="ja" />);
        io.fire();
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE + GRID_STEP);
        io.fire();
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE + GRID_STEP * 2);
    });

    it("最後まで足したら番兵を外す（無限に観測しない）", () => {
        const io = stubObserver();
        const { container } = render(<GalleryGrid photos={many(GRID_INITIAL_VISIBLE + 10)} locale="ja" />);
        io.fire();
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE + 10);
        expect(container.querySelector('[aria-hidden="true"][style*="height"]'), "番兵が残っている").toBeNull();
    });

    // **出さない方に倒さない。** 監視できない環境で60枚に打ち切ると、
    // その環境では残りの写真に一生辿り着けない
    it("IntersectionObserver が無い環境では全部描く", () => {
        delete (globalThis as unknown as Record<string, unknown>).IntersectionObserver;
        const { container } = render(<GalleryGrid photos={many(200)} locale="ja" />);
        expect(cards(container)).toBe(200);
    });

    it("絞り込みが変わったら最初から数え直す", () => {
        // **差し替えは1回だけ。** 2回呼ぶと、部品が掴んでいるのは1つ目の
        // クラスなのに2つ目の控えを見にいって空になる（最初そう書いて落とした）
        const io = stubObserver();
        const { container, rerender } = render(<GalleryGrid photos={many(500)} locale="ja" />);
        io.fire();
        expect(cards(container)).toBeGreaterThan(GRID_INITIAL_VISIBLE);
        rerender(<GalleryGrid photos={many(500).slice(0, 300)} locale="ja" />);
        expect(cards(container), "絞り込んでも前の枚数のままになっている").toBe(GRID_INITIAL_VISIBLE);
    });
});
