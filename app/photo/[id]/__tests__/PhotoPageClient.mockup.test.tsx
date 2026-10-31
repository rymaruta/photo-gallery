// @vitest-environment jsdom
// ↑ happy-dom では結果が変わる（原因は未調査。2026-09-30 の切り替えで落ちたもの）。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 最終版モックの並び（owner「全て完全一致するまで」）。
 *
 * 見ているのは**並びと、静的HTMLに残すべきものが DOM に残ること**。
 * 押し心地（いいね・保存・フォロー・コメント）は各フックと部品のテストが持つ。
 */
const mockShowToast = vi.fn();
const mockUserFetch = vi.fn(async (..._a: unknown[]) => ({ ok: false, status: 500, json: async () => ({}) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
const authState = { current: { isAuthenticated: false, userId: null as string | null, loading: false } };
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: { category: { names: { landscape: "風景" } } } }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
const likeState = vi.hoisted(() => ({ liked: false }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: likeState.liked, count: 342, pending: false, toggle: async () => ({ ok: true }) }),
}));
const saveState = { current: { saved: false, pending: false, toggle: vi.fn(async () => ({ ok: true })) } };
vi.mock("../../../../lib/hooks/usePhotoSave", () => ({ usePhotoSave: () => saveState.current }));
vi.mock("../../../components/UserAvatar", () => ({ default: ({ userId }: { userId: string }) => <span data-avatar={userId} /> }));
vi.mock("../../../components/FollowButton", () => ({
    FollowAction: ({ targetUserId, variant }: { targetUserId: string; variant?: string }) => <button type="button" data-follow={targetUserId} data-variant={variant}>フォロー</button>,
    default: () => null,
}));
vi.mock("../../../components/CommentSection", () => ({
    default: ({ hideHeading, onCountChange }: { hideHeading?: boolean; onCountChange?: (n: number) => void }) => (
        <div data-comments data-hide-heading={String(!!hideHeading)}>
            <button type="button" onClick={() => onCountChange?.(24)}>コメントが届いた</button>
        </div>
    ),
}));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const base = {
    id: "p1",
    src: "https://cdn.example.com/uploads/u1/a.jpg",
    userId: "u1",
    displayName: "Haruto",
    uploaderUsername: "haruto_travel",
    title: "夕陽に染まる白い街",
    description: "エーゲ海に沈む夕日が、白い街をやさしくオレンジ色に染めていく。",
    location: "サントリーニ島、ギリシャ",
    coords: { lat: 36.46, lng: 25.37 },
    date: "2024-05-12",
    category: "landscape",
    tags: ["サントリーニ", "ギリシャ"],
    likes: 342,
    commentCount: 24,
    exif: { camera: "Canon EOS R6", lens: "RF24-70mm", aperture: "f/8", exposure: "1/125", iso: 100 },
} as unknown as Photo;

const page = (p: Partial<Photo> = {}) => render(<PhotoPageClient photoId="p1" initialPhoto={{ ...base, ...p } as Photo} />);
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
    mockShowToast.mockReset();
    authState.current = { isAuthenticated: false, userId: null, loading: false };
    saveState.current = { saved: false, pending: false, toggle: vi.fn(async () => ({ ok: true })) };
});

describe("写真ページ: 最終版モックの並び", () => {
    // 2026-10-31 束 1 P4・P11: iOS の写真の詳細の順（題 → 日時 → 本文 → 作者 → 操作 → 撮影情報 → タグ → 関連 → コメント）。
    // 以前は 題 → 作者 → 日時と住所 → 本文 → タグ → 操作 → タブ
    it("並び: ヒーロー → 題 → 日時 → 本文 → 作者行 → 操作の段 → 撮影情報 → タグ → コメントの節", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const hero = screen.getByAltText(/夕陽に染まる白い街/);
        const title = screen.getByRole("heading", { level: 1 });
        const stamp = screen.getByTestId("photo-shot-stamp");
        const body = screen.getByText(/エーゲ海に沈む夕日/);
        const author = screen.getByRole("link", { name: "Haruto" });
        const like = screen.getByRole("button", { name: /^いいね \d/ });
        const exif = screen.getByTestId("photo-exif");
        const tag = screen.getByRole("link", { name: "#ギリシャ" });
        const comments = screen.getByRole("heading", { name: "コメント 24件" });
        for (const [a, b] of [[hero, title], [title, stamp], [stamp, body], [body, author], [author, like], [like, exif], [exif, tag], [tag, comments]] as const) {
            expect(before(a, b), "並びが iOS と違う").toBe(true);
        }
        expect(screen.queryByRole("tablist"), "コメントと関連写真の切り替えは無くした").toBeNull();
    });

    // 束 1 P2: 写真の裾は「📍 撮影地 · 撮影地の詳細」の行だけ（地図の丸は外し、「…」の中へ）
    it("写真の裾: 撮影地の行は /location/ へ、地図は「…」の中の /map#… へ", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const place = screen.getByTestId("photo-place-link");
        expect(place.getAttribute("href")).toContain("/location/");
        expect(place.textContent).toContain("撮影地の詳細");
        expect(screen.queryByTestId("photo-map-button"), "写真の上の地図の丸は外した").toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "その他" }));
        expect(screen.getByRole("menuitem", { name: "撮影地マップで見る" }).getAttribute("href")).toMatch(/^\/map#/);
    });

    it("作者行: アバター・名前・@名・枠線のフォロー。自分の写真にはフォローを出さない", async () => {
        const { container, unmount } = page();
        await screen.findByText("夕陽に染まる白い街");
        expect(container.querySelector("[data-avatar='u1']")).toBeTruthy();
        expect(screen.getByText("@haruto_travel")).toBeTruthy();
        expect(screen.getByRole("button", { name: "フォロー" }).getAttribute("data-variant")).toBe("outline");
        unmount();
        authState.current = { isAuthenticated: true, userId: "u1", loading: false };
        page();
        await screen.findByText("夕陽に染まる白い街");
        expect(screen.queryByRole("button", { name: "フォロー" })).toBeNull();
    });

    it("題の下の日時（撮影日が無ければ出さない）。住所の全文は本文の上に出さない", async () => {
        const { unmount } = page();
        await screen.findByText("夕陽に染まる白い街");
        expect(screen.getByTestId("photo-shot-stamp").textContent).toBe("2024.05.12");
        expect(screen.getByTestId("photo-headline").textContent).not.toContain("サントリーニ");
        unmount();
        page({ date: undefined });
        await screen.findByText("夕陽に染まる白い街");
        expect(screen.queryByTestId("photo-shot-stamp")).toBeNull();
    });

    // 束 1 P6: 印だけ（「保存」「シェア」の字を外す）・数は 0 より大きいときだけ・下に髪線
    it("操作の段: ♡ の数・💬 の数・保存・共有（印だけ）", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        // 見えている数（342）が読み上げの名前にも入る（Lighthouse の label-content-name-mismatch）
        const like = screen.getByRole("button", { name: "いいね 342件" });
        expect(like.textContent).toContain("342");
        expect(like.getAttribute("aria-pressed")).toBe("false");
        expect(screen.getByRole("button", { name: /コメント 24件/ })).toBeTruthy();
        const save = screen.getByRole("button", { name: "保存" });
        const share = screen.getByRole("button", { name: "共有" });
        expect(save.textContent, "字を外した").toBe("");
        expect(share.textContent, "字を外した").toBe("");
        expect(save.className, "保存も白（以前は真鍮）").not.toContain("text-accent");
    });

    it("数が 0 の操作は数を出さない（「0」が並ぶと空の画面に見える・iOS と同じ）", async () => {
        page({ commentCount: 0 } as Partial<Photo>);
        await screen.findByText("夕陽に染まる白い街");
        const c = screen.getByRole("button", { name: "コメントを見る" });
        expect(c.textContent).toBe("");
    });

    it("保存: 未ログインは「失敗」ではなく案内", async () => {
        saveState.current.toggle = vi.fn(async () => ({ ok: false, requiresAuth: true }));
        page();
        await screen.findByText("夕陽に染まる白い街");
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("写真を保存するにはログインしてください", "error"));
    });

    it("🔴 撮影情報は初期は畳まれているが、機材のリンクは DOM に残る（静的HTMLに焼く）", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const detail = document.getElementById("photo-exif-detail")!;
        expect(detail.hasAttribute("hidden"), "初期から開いている").toBe(true);
        expect(screen.getByText(/Canon EOS R6/).closest("a")?.getAttribute("href")).toContain("/camera/");
        fireEvent.click(screen.getByRole("button", { name: /撮影情報/ }));
        expect(detail.hasAttribute("hidden")).toBe(false);
    });

    it("🔴 コメントと関連写真は縦に節で（切り替えをやめた）。コメントの数は節の見出しに出る", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        expect(screen.queryAllByRole("tab")).toHaveLength(0);
        expect(document.getElementById("photo-panel-related")).toBeNull();
        expect(document.querySelector("[data-comments]")?.getAttribute("data-hide-heading")).toBe("true");
        const h = screen.getByRole("heading", { name: "コメント 24件" });
        expect(h.textContent).toBe("コメント24");
        fireEvent.click(screen.getByText("コメントが届いた"));
        expect(screen.getByRole("heading", { name: "コメント 24件" })).toBeTruthy();
    });

    it("💬 を押すとコメントの節へ送る", async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        page();
        await screen.findByText("夕陽に染まる白い街");
        fireEvent.click(screen.getByRole("button", { name: /コメント 24件/ }));
        expect(scroll).toHaveBeenCalled();
        expect(scroll.mock.contexts[0]).toBe(screen.getByTestId("photo-comments"));
    });

    it("⋯ メニュー: 共有・リンクをコピー・X・LINE・地図。通報はログイン中の他人の写真だけ", async () => {
        const { unmount } = page();
        await screen.findByText("夕陽に染まる白い街");
        fireEvent.click(screen.getByRole("button", { name: "その他" }));
        expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["共有", "リンクをコピー", "Xで共有", "LINEで共有", "撮影地マップで見る", "Google マップで開く"]);
        unmount();
        authState.current = { isAuthenticated: true, userId: "viewer", loading: false };
        page();
        await screen.findByText("夕陽に染まる白い街");
        fireEvent.click(screen.getByRole("button", { name: "その他" }));
        expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toContain("この投稿を通報する");
    });

    it("1枚だけならヒーローにスワイプの手を付けない（縦スクロールを奪わない）", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const hero = screen.getByAltText(/夕陽に染まる白い街/).closest("div.relative.w-full")?.parentElement as HTMLElement;
        expect(hero.style.touchAction).toBe("");
    });
});

// 押したあとも**名前は変えない**（押した状態は aria-pressed が伝える）。「いいねを取り消す」＋
// 「押されています」だと状態が二重で意味が逆に取れる（`ModalControls` の注記と同じ理由）
it("押したあとも名前は「いいね 342件」のまま、aria-pressed が true", async () => {
    likeState.liked = true;
    try {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const like = screen.getByRole("button", { name: "いいね 342件" });
        expect(like.getAttribute("aria-pressed")).toBe("true");
    } finally {
        likeState.liked = false;
    }
});
