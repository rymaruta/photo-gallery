import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";

// **写真ページはハイドレーションまで写真を隠さない。**
// この画面は検索の着地点。以前は `opacity-0`（ぼかしが無ければ黒い回転まで）を
// 静的HTMLに焼いていたので、JS が届いて React が付くまで写真が見えなかった
// （`Thumb` と同じ型。Chromium 実測・Fast 3G + CPU 4倍で一覧は 1.6秒 → 5.9秒）。
// LCP をそのぶん遅らせていた。

const mockPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: (...args: unknown[]) => mockPublicFetch(...args),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const base = { id: "p1", src: "https://cdn.example.com/uploads/u1/a.jpg", userId: "u1", title: "写真", exif: { camera: "X-T5" } };
const mainImage = () => screen.getByAltText(/写真/) as HTMLImageElement;
const setReady = (ready: boolean) => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => ready });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => (ready ? 1000 : 0) });
};
// jsdom は `complete`/`naturalWidth` をプロトタイプ自身のアクセサとして
// 持つので、`delete` すると**定義ごと消えて** `img.complete` が undefined に
// なる。控えて戻す
const saved = {
    complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete")!,
    naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")!,
};
const restore = () => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", saved.complete);
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", saved.naturalWidth);
};

beforeEach(() => mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] }));

describe("写真ページ: ハイドレーション前は隠さない", () => {
    it("静的HTMLでは本体の写真を透明にせず、黒い回転も出さない", () => {
        const html = renderToString(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        const img = /<img[^>]*alt="写真"[^>]*>/.exec(html)?.[0] ?? "";
        expect(img, "本体の <img> が見つからない").not.toBe("");
        expect(img, "JS が届くまで写真が透明のまま").not.toContain("opacity-0");
        expect(html, "届いている写真を黒い回転で覆う").not.toContain("animate-spin");
    });

    it("クライアント遷移で新しく作った本体は、届くまで隠して回転を出し、届いたら出す", () => {
        setReady(false);
        try {
            const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
            const img = mainImage();
            expect(img.className).toContain("opacity-0");
            expect(container.querySelector(".animate-spin"), "待っているのに回転が無い").not.toBeNull();
            fireEvent.load(img);
            expect(img.className).toContain("opacity-100");
            expect(container.querySelector(".animate-spin")).toBeNull();
        } finally { restore(); }
    });

    it("新しく作った時点で既に届いていれば隠さない", () => {
        setReady(true);
        try {
            const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
            expect(mainImage().className).toContain("opacity-100");
            expect(container.querySelector(".animate-spin")).toBeNull();
        } finally { restore(); }
    });

    it("読み込みに失敗したら、隠したままにせず失敗を出す", () => {
        setReady(false);
        try {
            render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
            fireEvent.error(mainImage());
            expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();
        } finally { restore(); }
    });
});

// 静的HTML由来の本体は、届いていなくても隠さない（`Thumb` と同じ理由。
// 本物のハイドレーションで確かめる）
describe("写真ページ: ハイドレーション由来の本体はブラウザに任せる", () => {
    const hydrate = async () => {
        const { hydrateRoot } = await import("react-dom/client");
        const { act } = await import("react");
        const host = document.createElement("div");
        const el = <PhotoPageClient photoId="p1" initialPhoto={base} />;
        host.innerHTML = renderToString(el);
        document.body.appendChild(host);
        const errors: unknown[] = [];
        let root: ReturnType<typeof hydrateRoot> | null = null;
        await act(async () => { root = hydrateRoot(host, el, { onRecoverableError: (e) => errors.push(e) }); });
        return { host, errors, cleanup: async () => { await act(async () => { root?.unmount(); }); host.remove(); } };
    };

    it("React が付く前に届いていれば（キャッシュ済みの再訪）、読み込み済みとして扱う", async () => {
        setReady(true);
        try {
            const { host, errors, cleanup } = await hydrate();
            try {
                expect(errors).toEqual([]);
                const img = host.querySelector('img[alt="写真"]')!;
                expect(img.className).toContain("opacity-100");
                // 読み込み済みになっていなければ EXIF の画面抽出が二度と走らない
                expect(host.querySelector(".animate-spin")).toBeNull();
            } finally { await cleanup(); }
        } finally { restore(); }
    });

    it("React が付く前に失敗し終えていれば、失敗を出す（破損表示を残さない）", async () => {
        setReady(true);
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 0 });
        try {
            const { host, errors, cleanup } = await hydrate();
            try {
                expect(errors).toEqual([]);
                expect(host.textContent).toContain("画像を読み込めません");
                expect(host.querySelector('img[alt="写真"]')).toBeNull();
            } finally { await cleanup(); }
        } finally { restore(); }
    });

    it("React が付いてもまだ届いていない本体を隠さず、回転も出さない", async () => {
        const { hydrateRoot } = await import("react-dom/client");
        const { act } = await import("react");
        const host = document.createElement("div");
        const el = <PhotoPageClient photoId="p1" initialPhoto={base} />;
        host.innerHTML = renderToString(el);
        document.body.appendChild(host);
        const errors: unknown[] = [];
        let root: ReturnType<typeof hydrateRoot> | null = null;
        try {
            await act(async () => { root = hydrateRoot(host, el, { onRecoverableError: (e) => errors.push(e) }); });
            expect(errors, "ハイドレーションの不一致").toEqual([]);
            const img = host.querySelector('img[alt="写真"]')!;
            expect(img.className).not.toContain("opacity-0");
            expect(host.querySelector(".animate-spin")).toBeNull();
            await act(async () => { fireEvent.load(img); });
            expect(img.className).toContain("opacity-100");
        } finally {
            await act(async () => { root?.unmount(); });
            host.remove();
        }
    });
});
