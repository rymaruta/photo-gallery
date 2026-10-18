import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

const share = vi.hoisted(() => ({ shareUrl: vi.fn(async () => "shared" as const), shareToTwitter: vi.fn(), shareToLine: vi.fn(), copyToClipboard: vi.fn(async () => true) }));
vi.mock("../../../../lib/utils/share", () => share);

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

/** ページに焼く JSON-LD（ImageObject とパンくず） */
function jsonLd(container: HTMLElement): Record<string, unknown>[] {
    return Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
        .map((el) => JSON.parse(el.textContent || "{}") as Record<string, unknown>);
}
function crumbName(container: HTMLElement): unknown {
    const b = jsonLd(container).find((d) => d["@type"] === "BreadcrumbList") as { itemListElement: { name: string }[] } | undefined;
    return b?.itemListElement[1]?.name;
}
function imageName(container: HTMLElement): unknown {
    return jsonLd(container).find((d) => d["@type"] === "ImageObject")?.name;
}
async function sharedText(): Promise<unknown> {
    share.shareUrl.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "共有" })[0]);
    await waitFor(() => expect(share.shareUrl).toHaveBeenCalled());
    return (share.shareUrl.mock.calls[0] as unknown[])[1];
}

// 見出しだけ直して、パンくず・構造化データ・共有の文言は「無題」/「写真」のままだった（2026-10-18）。
// 4か所とも見出しと同じ「<撮影地>の写真」に揃える
describe("写真ページ: 題が無い写真のパンくず・構造化データ・共有", () => {
    const { location: _omit, ...NO_PLACE } = NO_TITLE as unknown as Record<string, unknown>;
    void _omit;
    const cases: [string, Record<string, unknown>, string][] = [
        ["欄が無い・撮影地あり", { ...NO_TITLE }, "板橋区, 日本の写真"],
        ["空白だけ・撮影地あり", { ...NO_TITLE, title: { ja: "  " } }, "板橋区, 日本の写真"],
        ["{ ja: 無題, en: Untitled }・撮影地あり", { ...NO_TITLE, title: { ja: "無題", en: "Untitled" } }, "板橋区, 日本の写真"],
        ["欄が無い・撮影地なし", { ...NO_PLACE }, "写真"],
        ["{ ja: 無題 }・撮影地なし", { ...NO_PLACE, title: { ja: "無題" } }, "写真"],
        ["題あり", { ...NO_TITLE, title: { ja: "朝の湖" } }, "朝の湖"],
    ];
    for (const [name, photo, want] of cases) {
        it(`${name} → ${want}`, async () => {
            const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={photo as unknown as Photo} />);
            await screen.findAllByRole("heading", { level: 1 });
            expect(crumbName(container), "パンくず").toBe(want);
            expect(imageName(container), "ImageObject.name").toBe(want);
            expect(await sharedText(), "共有の文言").toBe(want);
            expect(container.innerHTML).not.toMatch(/無題|Untitled/);
        });
    }
});

// 前後の写真の札（見える文字）。旧い既定値の「無題」を出さない（題が無ければ今までどおり「写真」）
describe("写真ページ: 前後の写真の題", () => {
    it("{ ja: 無題 } の前後の写真は「写真」と出す", async () => {
        const prev = { id: "p0", src: "https://cdn.example.com/uploads/alice/0.webp", title: { ja: "無題", en: "Untitled" } };
        const next = { id: "p2", src: "https://cdn.example.com/uploads/alice/2.webp", title: { ja: "夕焼け" } };
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={{ ...NO_TITLE, title: { ja: "朝の湖" } } as unknown as Photo}
            initialRelated={{ author: [], location: [], prev, next, nearby: [] } as never} />);
        await screen.findAllByRole("heading", { level: 1 });
        const prevLink = container.querySelector('a[data-photo-id="p0"]');
        const nextLink = container.querySelector('a[data-photo-id="p2"]');
        expect(prevLink?.textContent).toContain("写真");
        expect(nextLink?.textContent).toContain("夕焼け");
        expect(container.innerHTML).not.toMatch(/無題|Untitled/);
    });
});

// 近くの写真のサムネの alt（名前が要る所）。旧い既定値の「無題」を出さない
describe("写真ページ: 近くの写真の alt", () => {
    it("{ ja: 無題 } の近くの写真の alt は代わりの題", async () => {
        const nearby = [{ id: "n1", src: "https://cdn.example.com/uploads/bob/n1.webp", title: { ja: "無題", en: "Untitled" } }];
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={{ ...NO_TITLE, title: { ja: "朝の湖" }, coords: { lat: 35, lng: 139 } } as unknown as Photo}
            initialRelated={{ author: [], location: [], prev: null, next: null, nearby } as never} />);
        await screen.findAllByRole("heading", { level: 1 });
        const link = container.querySelector('a[data-photo-id="n1"]');
        expect(link, "近くの写真が描かれていない").toBeTruthy();
        const el = link!.querySelector('img[alt]:not([alt=""]), [role="img"]');
        expect(el?.getAttribute("alt") ?? el?.getAttribute("aria-label")).toBe("写真");
        expect(container.innerHTML).not.toMatch(/無題|Untitled/);
    });
});
