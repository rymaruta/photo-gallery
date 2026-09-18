import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * マイページの「フォロー中」タブ。
 *
 * owner:「マイページの写真だけど、デフォルトは自分のみがいい。自分のみ、
 * フォロー中がいい。全てはサイトのトップページとかで確認できると思う」
 *
 * - 既定は投稿（自分の写真）のまま
 * - **本人にだけ**フォロー中が出て、押すと `TimelineFeed` が描かれる
 * - 訪問者には出ない（スワイプでも辿り着かない）
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
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
// 中身は `TimelineFeed.test.tsx` が守る。ここは**配線**（タブが出る・押すと描く）
vi.mock("../../components/TimelineFeed", () => ({ default: () => <div data-testid="timeline-feed" /> }));

const OWNER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
import UserProfileClient from "../UserProfileClient";

const asUser = (sub: string) =>
    mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub } }) });
const asOwner = () => asUser(OWNER);
const tabBar = () => document.querySelector("button[data-profile-tab]")?.parentElement;

const tabNames = () =>
    Array.from(document.querySelectorAll("button[data-profile-tab]")).map((b) => b.textContent?.trim());
const activeTab = () =>
    document.querySelector('button[data-profile-tab][aria-pressed="true"]')?.getAttribute("data-profile-tab");
function swipe(dir: "left" | "right") {
    const area = screen.getByTestId("tab-swipe-area");
    const from = dir === "left" ? 240 : 60;
    const to = dir === "left" ? 60 : 240;
    fireEvent.pointerDown(area, { clientX: from, clientY: 100 });
    fireEvent.pointerUp(area, { clientX: to, clientY: 108 });
}

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }) });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

describe("マイページの「フォロー中」タブ", () => {
    it("本人には出る。既定は投稿のままで、押すとフォロー中の流れが描かれる", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        const tab = await screen.findByRole("button", { name: /フォロー中/ });
        expect(tabNames()).toEqual(["投稿", "年表", "フォロー中"]);
        // 3つ目が2段目に落ちない（列の指定も本人のときだけ3に）
        expect(tabBar()?.className).toContain("grid-cols-3");
        expect(activeTab(), "既定が自分の写真でない").toBe("posts");
        expect(screen.queryByTestId("timeline-feed"), "押す前から描いている").toBeNull();
        fireEvent.click(tab);
        expect(activeTab()).toBe("following");
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
    });

    it("訪問者には出ない（スワイプで進んでも年表で止まる）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        expect(tabNames()).toEqual(["投稿", "年表"]);
        expect(tabBar()?.className).toContain("grid-cols-2");
        swipe("left"); swipe("left");
        expect(activeTab()).toBe("timeline");
        expect(screen.queryByTestId("timeline-feed"), "訪問者にフォロー中を描いている").toBeNull();
    });

    // **ログインしていても他人には出さない**——「本人か」は `isOwner`（sub の一致）で
    // 決める。`viewerAuthed`（ログイン済みか）で決めると、誰のページでも出る
    it("ログイン済みの他人のページには出ない", async () => {
        asUser(OTHER);
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        // セッションの反映を待つ（フォローボタンが出る＝ログイン済みとして描かれた）
        await screen.findByRole("button", { name: /フォロー/ });
        expect(tabNames(), "他人のフォロー先を、その人のページで見せている").toEqual(["投稿", "年表"]);
        swipe("left"); swipe("left");
        expect(activeTab()).toBe("timeline");
    });

    it("本人はスワイプでも フォロー中 に届く（投稿 → 年表 → フォロー中）", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        await screen.findByRole("button", { name: /フォロー中/ });
        swipe("left");
        expect(activeTab()).toBe("timeline");
        swipe("left");
        expect(activeTab()).toBe("following");
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
        swipe("left");   // 右端で止まる
        expect(activeTab()).toBe("following");
    });
});
