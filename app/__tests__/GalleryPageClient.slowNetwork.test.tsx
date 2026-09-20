import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// 「回線が遅い・返らない」ときの画面。実測（実ブラウザ・応答を保持）で
// 出ていた2つ:
//  - 通知や共有リンクから開いた `?photo=` が**永久に開かず、理由も出ない**
//    （3秒・10秒・30秒とも モーダルもトーストも無し）
//  - 「フォロー中」が**完全な空白**（読み込み中とも失敗とも分からない）
//    → いまはマイページの「フォロー中」タブに移った。守りは `TimelineFeed.test.tsx`

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast, toasts: [], removeToast: vi.fn() }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    publicFetch: vi.fn(() => new Promise(() => {})),
    userPublicFetch: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => <div>grid</div> }));
vi.mock("../components/GalleryModal", () => ({ default: () => <div>modal</div> }));
// `?photo=` は `SearchParamWatcher` 経由で入る。**本物に近い形で渡す**
// （null を返す偽物だと、この経路のテストが何も測らない）
function FakeSearchParamWatcher({ name, onChange }: { name: string; onChange: (v: string | null) => void }) {
    React.useEffect(() => {
        onChange(new URLSearchParams(window.location.search).get(name));
    }, [name, onChange]);
    return null;
}
vi.mock("../components/SearchParamWatcher", () => ({ default: FakeSearchParamWatcher }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// **本番は失敗しても手元のスナップショット（photos.json）が残る**
// （`usePhotos` は空配列でそれを潰さない）。空配列で模すと、
// 「開ける写真があるのに理由を出す」回帰がテストから消える
const SNAPSHOT = [{
    id: "snap-1", src: "https://cdn/snap.jpg", userId: "u1",
    title: { ja: "手元にある写真" }, category: "x", tags: [],
    date: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", published: true,
}];
const photosState = vi.hoisted(() => ({ current: { loaded: false, failed: false, photos: [] as unknown[] } }));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ loading: false, ...photosState.current }),
}));

import ToastProvider from "../components/ToastProvider";
const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(async () => {
    showToast.mockReset();
    photosState.current = { loaded: false, failed: false, photos: SNAPSHOT };
    window.history.replaceState({}, "", "/");
    mockUserFetch.mockReset().mockImplementation(() => new Promise(() => {}));   // 返らない
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

describe("回線が遅いとき", () => {
    it("一覧が取れないままなら、開けない写真の理由を出す", async () => {
        photosState.current = { loaded: false, failed: true, photos: SNAPSHOT };
        window.history.replaceState({}, "", "/?photo=abc");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast.mock.calls[0][0]).toMatch(/写真を読み込めませんでした/);
        expect(showToast.mock.calls[0][1]).toBe("error");
    });

    // 逆向き: **まだ来ていないだけなら黙って待つ**（届く前に嘘をつかない）
    it("まだ届いていないだけなら、何も言わずに待つ", async () => {
        photosState.current = { loaded: false, failed: false, photos: SNAPSHOT };
        window.history.replaceState({}, "", "/?photo=abc");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await new Promise((r) => setTimeout(r, 50));
        expect(showToast, "届く前に「読み込めませんでした」と言っている").not.toHaveBeenCalled();
    });

    // **回帰**（レビューが実測）: 判定を `openById` より前に置いたら、
    // 手元のスナップショットで開ける写真の上に「読み込めませんでした」を出し、
    // `?photo=` を URL から消していた。本番の30枚＝共有リンクの大多数が該当
    it("一覧が取れなくても、手元にある写真は開く（理由を出さない）", async () => {
        photosState.current = { loaded: false, failed: true, photos: SNAPSHOT };
        window.history.replaceState({}, "", "/?photo=snap-1");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(screen.getByText("modal")).toBeInTheDocument());
        expect(showToast, "開いている写真に「読み込めませんでした」と言っている").not.toHaveBeenCalled();
        expect(window.location.search, "開けたのに ?photo= を消している").toContain("photo=snap-1");
    });

    // **絞り込みで空のときも、手元にある写真は断らない**（レビューが実測）。
    // どの写真にも当たらない絞り込みで写真APIが落ちている場面がこれ。
    // 手元にある写真は**絞りを外して開く**（「読み込めませんでした」ではない）
    it("絞り込みで空でも、手元にある写真は絞りを外して開く（理由を出さない）", async () => {
        photosState.current = { loaded: false, failed: true, photos: SNAPSHOT };
        window.history.replaceState({}, "", "/?photo=snap-1&category=nothing-matches");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(screen.getByText("modal")).toBeInTheDocument());
        expect(showToast.mock.calls.map((c) => String(c[0])).join("\n"), "開ける写真なのに断っている")
            .not.toMatch(/読み込めませんでした/);
        expect(window.location.search).toContain("photo=snap-1");
    });

    // **待ち id を捨てない。** 通信の失敗は一時的で、`usePhotos` は戻ってきた
    // ときに取り直す。id を捨てると取り直しが成功しても開き直せない
    it("理由を出しても、?photo= は URL に残す", async () => {
        photosState.current = { loaded: false, failed: true, photos: SNAPSHOT };
        window.history.replaceState({}, "", "/?photo=not-in-snapshot");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(window.location.search, "取り直せるのに id を捨てている").toContain("photo=not-in-snapshot");
    });
});
