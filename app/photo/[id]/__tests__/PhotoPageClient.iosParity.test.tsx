import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * iOS 版にそろえた写真ページ（2026-10-21）:
 *  - スマホでは戻る・共有・「…」を写真の上のガラスの丸（44px）に重ね、上に黒のぼかし
 *  - 写真を押すと全画面（`PhotoViewer`）。Esc で閉じ、開いたボタンへ戻る
 *  - 全画面で2回叩くといいね（いいね済みは消さない）
 *  - 撮影日は「2024.05.12 · 18:24」
 */
const auth = vi.hoisted(() => ({ isAuthenticated: true, userId: "viewer" as string | null, loading: false }));
vi.mock("../../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: vi.fn(() => new Promise(() => undefined)),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
const like = vi.hoisted(() => ({ liked: false, toggle: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: like.liked, count: 7, pending: false, toggle: like.toggle }),
}));

// 全画面は `next/dynamic` で後ろへ回してある。**本物の loader を通す**（`HighlightsRow.test.tsx` と同じ）
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
        return function Lazy(props: Record<string, unknown>) {
            const [C, setC] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
            React.useEffect(() => {
                let alive = true;
                void loader().then((m) => { if (alive) setC(() => m.default); });
                return () => { alive = false; };
            }, []);
            return C ? <C {...props} /> : null;
        };
    },
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const BASE = {
    id: "p1", src: "https://cdn.example.com/uploads/alice/a.webp", title: "朝の湖", userId: "alice",
    displayName: "アリス", location: "銀山温泉", date: "2024-05-12",
} as unknown as Photo;

// 写真が「届いている」ことにする（テストの DOM は外の画像を読まず、何もしないと
// `complete && naturalWidth === 0`＝読み込み失敗と見えて、全画面を開かない側に入る）
let ready = true;
const saved = {
    complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete"),
    naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth"),
};
beforeEach(() => {
    like.liked = false;
    like.toggle.mockClear();
    ready = true;
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => ready });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => (ready ? 1000 : 0) });
});
afterEach(() => {
    if (saved.complete) Object.defineProperty(HTMLImageElement.prototype, "complete", saved.complete);
    else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
    if (saved.naturalWidth) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", saved.naturalWidth);
    else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
});

describe("写真ページ: 写真の上の戻る・共有・「…」（A1）", () => {
    it("3つとも上の列にあり、当たりは 44px・写真の上ではガラスの丸（黒 55%＋ぼかし）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        const bar = screen.getByTestId("photo-top-bar");
        // スマホは写真に重ねる（行のぶん写真を下げない）、PC は今までどおり行
        expect(bar.className).toMatch(/(^| )absolute( |$)/);
        expect(bar.className).toContain("lg:static");
        for (const name of ["ギャラリーに戻る", "共有", "その他"]) {
            const el = screen.getByRole(name === "ギャラリーに戻る" ? "link" : "button", { name });
            expect(bar.contains(el), name).toBe(true);
            expect(el.style.width, name).toBe("44px");
            expect(el.style.height, name).toBe("44px");
            expect(el.className, name).toContain("bg-black/55");
            expect(el.className, name).toContain("backdrop-blur");
            expect(el.className, name).toContain("pointer-events-auto");
        }
    });

    it("写真の上の端に黒のぼかしを敷く（スマホだけ・押せない飾り）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        const scrim = screen.getByTestId("photo-top-scrim");
        expect(scrim.getAttribute("aria-hidden")).toBe("true");
        expect(scrim.className).toContain("lg:hidden");
        expect(scrim.className).toContain("pointer-events-none");
    });
});

describe("写真ページ: 撮影日の1行（A6）", () => {
    it("「2024.05.12」を等幅の数字で", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        const stamp = await screen.findByTestId("photo-shot-stamp");
        expect(stamp.textContent).toBe("2024.05.12");
        expect(stamp.className).toContain("tabular-nums");
    });

    it("EXIF の撮影時刻が同じ日なら「 · 18:24」を足す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, exif: { dateTimeOriginal: "2024-05-12T18:24:00" } } as Photo} />);
        expect((await screen.findByTestId("photo-shot-stamp")).textContent).toBe("2024.05.12 · 18:24");
    });
});

describe("写真ページ: 全画面で見る（A2）", () => {
    it("写真を押すと全画面のダイアログ。閉じるは 44px で、そこにフォーカス", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("photo-viewer")).toBeNull();
        fireEvent.click(screen.getByTestId("photo-hero-open"));
        const dialog = await screen.findByRole("dialog", { name: "朝の湖（全画面）" });
        await act(async () => {});
        expect(dialog.getAttribute("aria-modal")).toBe("true");
        const close = screen.getByRole("button", { name: "閉じる" });
        expect(close.style.width).toBe("44px");
        expect(close.style.height).toBe("44px");
        expect(document.activeElement).toBe(close);
    });

    it("Esc で閉じ、開いた写真のボタンへフォーカスが戻る", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        const hero = screen.getByTestId("photo-hero-open");
        hero.focus();
        fireEvent.click(hero);
        expect(await screen.findByTestId("photo-viewer")).toBeTruthy();
        // 後から読んだ部品の購読（useEffect）が張られるまで1拍待つ
        await act(async () => {});
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByTestId("photo-viewer")).toBeNull();
        expect(document.activeElement).toBe(hero);
    });

    it("Tab は全画面の外へ出ない（フォーカスを閉じ込める）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        fireEvent.click(screen.getByTestId("photo-hero-open"));
        const dialog = await screen.findByTestId("photo-viewer");
        await act(async () => {});
        const focusables = dialog.querySelectorAll<HTMLElement>("button:not([disabled])");
        const last = focusables[focusables.length - 1];
        last.focus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("2回叩くといいね。いいね済みなら消さない（演出だけ）", async () => {
        const now = vi.spyOn(Date, "now");
        try {
            const { rerender } = render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
            await screen.findByText("朝の湖");
            fireEvent.click(screen.getByTestId("photo-hero-open"));
            const stage = await screen.findByTestId("photo-viewer-stage");
            now.mockReturnValue(10_000);
            fireEvent.click(stage, { clientX: 100, clientY: 100 });
            now.mockReturnValue(10_200);
            await act(async () => { fireEvent.click(stage, { clientX: 105, clientY: 102 }); });
            expect(like.toggle).toHaveBeenCalledTimes(1);

            like.liked = true;
            rerender(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE }} />);
            now.mockReturnValue(20_000);
            fireEvent.click(stage, { clientX: 100, clientY: 100 });
            now.mockReturnValue(20_200);
            await act(async () => { fireEvent.click(stage, { clientX: 100, clientY: 100 }); });
            expect(like.toggle, "いいね済みは解除しない").toHaveBeenCalledTimes(1);
        } finally {
            now.mockRestore();
        }
    });

    it("離れた所を続けて叩いても、間が空いてもいいねにならない", async () => {
        const now = vi.spyOn(Date, "now");
        try {
            render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
            await screen.findByText("朝の湖");
            fireEvent.click(screen.getByTestId("photo-hero-open"));
            const stage = await screen.findByTestId("photo-viewer-stage");
            now.mockReturnValue(10_000);
            fireEvent.click(stage, { clientX: 10, clientY: 10 });
            now.mockReturnValue(10_100);
            fireEvent.click(stage, { clientX: 300, clientY: 300 });
            now.mockReturnValue(11_000);
            fireEvent.click(stage, { clientX: 300, clientY: 300 });
            expect(like.toggle).not.toHaveBeenCalled();
        } finally {
            now.mockRestore();
        }
    });

    // iOS の Safari はボタンを押してもフォーカスを当てない。戻り先を明示していないと
    // 閉じたときにフォーカスがページの先頭（body）へ落ちる
    it("フォーカスを当てずに開いても、閉じたら写真のボタンへ戻る", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);
        fireEvent.click(screen.getByTestId("photo-hero-open"));
        await screen.findByTestId("photo-viewer");
        await act(async () => {});
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(screen.queryByTestId("photo-viewer")).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId("photo-hero-open"));
    });

    it("マウスを引いて送ったあとの click では開かない（叩いたときだけ開く）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        const hero = screen.getByTestId("photo-hero-open");
        fireEvent.pointerDown(hero, { clientX: 300, clientY: 200 });
        fireEvent.click(hero, { clientX: 120, clientY: 205 });
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByTestId("photo-viewer")).toBeNull();
        // 同じ所で離せば開く
        fireEvent.pointerDown(hero, { clientX: 300, clientY: 200 });
        fireEvent.click(hero, { clientX: 303, clientY: 202 });
        expect(await screen.findByTestId("photo-viewer")).toBeTruthy();
    });

    it("写真を読み込めなかったときは、押しても開かない", async () => {
        ready = false;   // まだ届いていない（読み込みの途中で失敗する形）
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        const img = container.querySelector<HTMLImageElement>('[data-testid="photo-hero-open"] img')!;
        fireEvent.error(img);
        const hero = screen.getByTestId("photo-hero-open");
        fireEvent.click(hero);
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByTestId("photo-viewer")).toBeNull();
        expect(hero.getAttribute("aria-haspopup")).toBeNull();
    });
});
