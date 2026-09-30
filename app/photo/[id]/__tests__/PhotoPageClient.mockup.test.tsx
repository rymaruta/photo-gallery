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
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 342, pending: false, toggle: async () => ({ ok: true }) }),
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
    it("並び: ヒーロー → 題 → 作者行 → 撮影日·撮影地 → 本文 → チップ → アクション行 → タブ", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const hero = screen.getByAltText(/夕陽に染まる白い街/);
        const title = screen.getByRole("heading", { level: 1 });
        const author = screen.getByRole("link", { name: "Haruto" });
        const body = screen.getByText(/エーゲ海に沈む夕日/);
        const tag = screen.getByRole("link", { name: "#ギリシャ" });
        const like = screen.getByRole("button", { name: /^いいね \d/ });
        const tabs = screen.getByRole("tablist");
        for (const [a, b] of [[hero, title], [title, author], [author, body], [body, tag], [tag, like], [like, tabs]] as const) {
            expect(before(a, b), "並びがモックと違う").toBe(true);
        }
    });

    it("ヒーローの上: 撮影地のチップは /location/ へ、地図のアイコンは /map#… へ", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const chips = screen.getAllByText("サントリーニ島、ギリシャ").map((e) => e.closest("a")).filter(Boolean) as HTMLAnchorElement[];
        expect(chips.some((a) => a.getAttribute("href")?.includes("/location/")), "撮影地のチップが集約ページへ繋がっていない").toBe(true);
        expect(screen.getByRole("link", { name: "撮影地マップで見る" }).getAttribute("href")).toMatch(/^\/map#/);
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

    it("撮影日 · 撮影地 の行（撮影日が無ければ撮影地だけ）", async () => {
        const { unmount } = page();
        await screen.findByText("夕陽に染まる白い街");
        // 撮影日の行と撮影情報カードの両方に出る
        expect(screen.getAllByText("2024年5月12日").length).toBeGreaterThan(0);
        unmount();
        page({ date: undefined });
        await screen.findByText("夕陽に染まる白い街");
        expect(screen.queryByText(/2024年/)).toBeNull();
    });

    it("アクション行: ♡ の数・💬 の数・保存・シェア（文字付き）", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        // 見えている数（342）が読み上げの名前にも入る（Lighthouse の label-content-name-mismatch）
        const like = screen.getByRole("button", { name: "いいね 342件" });
        expect(like.textContent).toContain("342");
        expect(screen.getByRole("button", { name: /コメント 24件/ })).toBeTruthy();
        expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "シェア" })).toBeTruthy();
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
        const dl = screen.getByText("Canon EOS R6").closest("dl")!;
        expect(dl.hasAttribute("hidden"), "初期から開いている").toBe(true);
        expect(screen.getByText("Canon EOS R6").closest("a")?.getAttribute("href")).toContain("/camera/");
        fireEvent.click(screen.getByRole("button", { name: "詳しく見る" }));
        expect(dl.hasAttribute("hidden")).toBe(false);
    });

    it("🔴 タブ: コメント／関連写真。見えない側の中身も DOM に残り、コメント数はタブに出る", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((t) => t.textContent)).toEqual(["コメント (24)", "関連写真"]);
        expect(tabs[0].getAttribute("aria-selected")).toBe("true");
        const related = document.getElementById("photo-panel-related")!;
        expect(related.hasAttribute("hidden")).toBe(true);
        expect(document.querySelector("[data-comments]")?.getAttribute("data-hide-heading")).toBe("true");
        fireEvent.click(tabs[1]);
        expect(related.hasAttribute("hidden")).toBe(false);
        expect(document.getElementById("photo-panel-comments")!.hasAttribute("hidden")).toBe(true);
        // コメントの部品が数を報告したらタブの数字が変わる
        fireEvent.click(screen.getByText("コメントが届いた"));   // hidden の中なので role では引けない
        expect(screen.getAllByRole("tab")[0].textContent).toBe("コメント (24)");
    });

    it("💬 を押すとコメントのタブへ", async () => {
        page();
        await screen.findByText("夕陽に染まる白い街");
        fireEvent.click(screen.getAllByRole("tab")[1]);
        fireEvent.click(screen.getByRole("button", { name: /コメント 24件/ }));
        expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
    });

    it("⋯ メニュー: リンクをコピー・X・LINE。通報はログイン中の他人の写真だけ", async () => {
        const { unmount } = page();
        await screen.findByText("夕陽に染まる白い街");
        fireEvent.click(screen.getByRole("button", { name: "その他" }));
        expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["リンクをコピー", "Xで共有", "LINEで共有"]);
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
