import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * 🔴 **React より先に失敗が終わっていたカバー写真を、`onError` は拾えない。**
 *
 * カバーは**このページの静的HTMLに焼かれる**。`<img>` はパースの時点で
 * 要求され、カバーを設定していない人なら配信が数十msで断る——React が付くのは
 * 早くても数百ms後なので、`error` は**誰も聞いていないうちに終わっている**。
 * 落ちないと**画面いっぱいの帯にブラウザの破損表示**が残る（`alt=""` でも
 * Chromium は描く）。アバターより目立つ場所。
 *
 * 同じ形は `Thumb` と写真ページ本体で直してあった（`fa640312`）。
 * **アバターとカバーの2つだけ置いてきていた**——実ビルド145ページを
 * Chromium で走査して、壊れた `<img>` が31ページに残っているのが見えて分かった。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.test");
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

const UserProfileClient = (await import("../UserProfileClient")).default;

const OWNER = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

/**
 * jsdom は `complete`/`naturalWidth` をプロトタイプ自身のアクセサとして
 * 持つので、`delete` すると**定義ごと消える**。ディスクリプタを戻す
 */
const stubImage = (complete: boolean, naturalWidth: number) => {
    const saved = {
        complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete")!,
        naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")!,
    };
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => complete });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => naturalWidth });
    return () => {
        Object.defineProperty(HTMLImageElement.prototype, "complete", saved.complete);
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", saved.naturalWidth);
    };
};

const covers = (c: HTMLElement) =>
    [...c.querySelectorAll("img")].filter((i) => (i.getAttribute("src") ?? "").includes("/cover"));

describe("カバー写真が読めないとき", () => {
    it("React が付く前に失敗し終えていたら、帯ごと消す", async () => {
        const restore = stubImage(true, 0);
        try {
            const { container } = render(<UserProfileClient userId={OWNER} />);
            await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
            expect(covers(container), "破損表示が残っている").toHaveLength(0);
        } finally { restore(); }
    });

    // **届いているカバーを消さない**（こちらの方が大事）
    it("届いているカバーはそのまま出す", async () => {
        const restore = stubImage(true, 1280);
        try {
            const { container } = render(<UserProfileClient userId={OWNER} />);
            await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
            expect(covers(container), "正当なカバーを消している").toHaveLength(1);
        } finally { restore(); }
    });

    it("読み込み中のカバーを失敗にしない", async () => {
        const restore = stubImage(false, 0);
        try {
            const { container } = render(<UserProfileClient userId={OWNER} />);
            await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
            expect(covers(container), "読み込み中を失敗にしている").toHaveLength(1);
        } finally { restore(); }
    });
});
