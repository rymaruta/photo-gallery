import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 題が無い写真の見出し（2026-10-17 本番のデプロイ前スモークが止まった件）。
 *
 * 題は空にできる（`api-user/src/upload.ts` は空なら `title` の欄ごと持たない）。
 * 以前は `<h1>{titleText}</h1>` を無条件に描いていたので、**中身の無い見出し**に
 * なっていた。旧い写真はサーバーが `{ ja: "無題" }` を入れていて、こちらは
 * 一覧（`displayTitle`）では消しているのに、写真ページの見出しには「無題」と出ていた。
 *
 * 決まり: 題があれば今までどおり見える見出し。無ければ（「無題」を含む）
 * 読み上げ用の見出し（`sr-only`）に「<撮影地>の写真」／「写真」。画面の見た目は増やさない。
 */
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
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
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

/** 本番の c9a54af7 と同じ形: `title` の欄そのものが無い */
const NO_TITLE = {
    id: "p1", src: "https://cdn.example.com/uploads/alice/a.webp", userId: "alice",
    displayName: "アリス", location: "板橋区, 日本",
} as unknown as Photo;

function heading() {
    const all = screen.getAllByRole("heading", { level: 1 });
    expect(all, "見出しは1つ").toHaveLength(1);
    return all[0];
}

describe("写真ページ: 題が無い写真の見出し", () => {
    it("title の欄が無く撮影地がある → 読み上げ用の見出し「<撮影地>の写真」", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={NO_TITLE} />);
        await screen.findAllByRole("heading", { level: 1 });
        const h1 = heading();
        expect(h1.textContent).toBe("板橋区, 日本の写真");
        expect(h1.className).toContain("sr-only");
    });

    it("title の欄も撮影地も無い → 「写真」", async () => {
        const { location: _omit, ...rest } = NO_TITLE as unknown as Record<string, unknown>;
        void _omit;
        render(<PhotoPageClient photoId="p1" initialPhoto={rest as unknown as Photo} />);
        await screen.findAllByRole("heading", { level: 1 });
        const h1 = heading();
        expect(h1.textContent).toBe("写真");
        expect(h1.className).toContain("sr-only");
    });

    it("サーバーが入れていた { ja: \"無題\" } も題として扱わない（「無題」を見出しに出さない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...NO_TITLE, title: { ja: "無題", en: "Untitled" } } as unknown as Photo} />);
        await screen.findAllByRole("heading", { level: 1 });
        const h1 = heading();
        expect(h1.textContent).toBe("板橋区, 日本の写真");
        expect(h1.className).toContain("sr-only");
        expect(screen.queryByText("無題")).toBeNull();
    });

    it("{ ja: \"無題\" } で撮影地も無い → 「写真」", async () => {
        const { location: _omit, ...rest } = NO_TITLE as unknown as Record<string, unknown>;
        void _omit;
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...rest, title: { ja: "無題" } } as unknown as Photo} />);
        await screen.findAllByRole("heading", { level: 1 });
        expect(heading().textContent).toBe("写真");
    });

    it("題があれば今までどおり見える見出し（sr-only にしない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...NO_TITLE, title: "朝の湖" } as unknown as Photo} />);
        await screen.findAllByRole("heading", { level: 1 });
        const h1 = heading();
        expect(h1.textContent).toBe("朝の湖");
        expect(h1.className).not.toContain("sr-only");
    });
});
