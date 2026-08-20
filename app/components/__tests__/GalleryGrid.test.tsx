import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GalleryGrid from "../GalleryGrid";
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
