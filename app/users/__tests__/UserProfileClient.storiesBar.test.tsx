import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

/**
 * ストーリー（24時間で消える投稿）の置き場所。
 *
 * owner:「ストーリー見れる場所もマイページに移設したいな」——以前はトップに
 * 置いていた。投稿する入口（「投稿する」）と同じ場所に集める。
 *
 * **本人のページだけ。** バーに出るのは自分とフォローしている人のぶんなので、
 * 他人のプロフィールに置く筋が無い（訪問者には自分のフォロー状況が漏れる）。
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

// **本物の loader を通す。** `default: () => () => <div/>` の形だと、
// 遅延読み込みの先が `StoriesBar` であることを誰も確かめない
// （行き先を別の部品に差し替えても緑になる）
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<{ default: React.ComponentType }>) => {
        return function Lazy() {
            const [C, setC] = React.useState<React.ComponentType | null>(null);
            React.useEffect(() => {
                let alive = true;
                void loader().then((m) => { if (alive) setC(() => m.default); });
                return () => { alive = false; };
            }, []);
            return C ? <C /> : null;
        };
    },
}));
vi.mock("../../components/stories/StoriesBar", () => ({
    default: () => <div data-testid="stories-bar">ストーリー</div>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/users/x" }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../data/photos.json", () => ({ default: [] }));

const OWNER = "33333333-3333-4333-8333-333333333333";
import UserProfileClient from "../UserProfileClient";

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }) });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
    document.body.innerHTML = "";
});

describe("マイページのストーリー", () => {
    it("本人のページには出る", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });
        render(<UserProfileClient userId={OWNER} />);
        expect(await screen.findByTestId("stories-bar"), "マイページにストーリーが無い").toBeInTheDocument();
    });

    // ⚠️ 遅延読み込みなので「まだ」と「出ない」を取り違えない。
    // **本人のときに出る合図（表示名が出そろう）を待ってから**見る
    it("訪問者には出ない（他人のフォロー状況を見せない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        expect(await screen.findByText("旅人")).toBeInTheDocument();
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.queryByTestId("stories-bar"), "他人のページにストーリーが出ている").toBeNull();
    });
});
