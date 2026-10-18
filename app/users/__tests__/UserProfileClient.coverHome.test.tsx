import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **カバー写真と居住地**（2026-10-11 owner・板 05c・05d・31・iOS の `ProfileCover`）。
// - カバーは `profiles/<uid>/cover` を読み、**出せたときだけ**帯を広げて見出しを重ねる
// - 無い人（読み込みに失敗）には帯を出さない（板 05d）
// - 居住地は「@名 · 居住地」の1行（公開プロフィールの `homeLocation`）

vi.hoisted(() => { process.env.NEXT_PUBLIC_CLOUDFRONT_URL = "https://cdn.example.com"; });

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

import UserProfileClient from "../UserProfileClient";

const ME = "11111111-1111-4111-8111-111111111111";

/**
 * 画像の読み込み状態を決める（`UserAvatar.test.tsx` と同じ手）。テストの DOM は
 * 読み込む前から `complete` を真で返すので、既定は「まだ読み込み中」にしておく
 */
const saved = {
    complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete")!,
    naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")!,
};
const stubImage = (complete: boolean, naturalWidth: number) => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => complete });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => naturalWidth });
};
afterEach(() => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", saved.complete);
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", saved.naturalWidth);
});

beforeEach(() => {
    stubImage(false, 0);
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset();
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

function profileResponse(body: unknown) {
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => body });
}

const coverImg = (c: HTMLElement) => c.querySelector<HTMLImageElement>("[data-testid=profile-cover] img");

describe("プロフィールのカバー写真", () => {
    it("profiles/<uid>/cover を読み、出せたら 180px の帯を広げて見出しを重ねる", async () => {
        profileResponse({ userId: ME, displayName: "旅人" });
        const { container } = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        const img = coverImg(container);
        expect(img, "カバーを読みに行っていない").not.toBeNull();
        expect(img!.getAttribute("src")).toMatch(new RegExp(`/profiles/${ME}/cover$`));
        // 読み込み中は場所を取らない（無い人で見出しが跳ねない）
        const band = container.querySelector<HTMLElement>("[data-testid=profile-cover]")!;
        expect(band.style.height).toBe("0px");
        fireEvent.load(img!);
        await waitFor(() => expect(band.style.height).toBe("180px"));
        // 見出しが帯の下端に重なる（上の余白が増える）
        const heading = screen.getByRole("heading", { level: 1 });
        const header = heading.closest<HTMLElement>("div[style*='padding-top']");
        expect(header, "カバーがあるのに見出しを下げていない").not.toBeNull();
    });

    it("カバーが無い人（読み込みに失敗）には帯を出さない（板 05d）", async () => {
        profileResponse({ userId: ME, displayName: "旅人" });
        const { container } = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        fireEvent.error(coverImg(container)!);
        await waitFor(() => expect(container.querySelector("[data-testid=profile-cover]")).toBeNull());
        const heading = screen.getByRole("heading", { level: 1 });
        expect(heading.closest("div[style*='padding-top']")).toBeNull();
    });
});

describe("カバーが無いときの額縁（#304・板 52）", () => {
    const head = vi.fn();
    beforeEach(() => {
        head.mockReset().mockResolvedValue({ status: 404 });
        vi.stubGlobal("fetch", head);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it("絵を読めなかっただけ（HEAD も届かない・圏外）なら本人でも出さない", async () => {
        head.mockRejectedValue(new Error("offline"));
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: ME } }) });
        profileResponse({ userId: ME, displayName: "旅人" });
        const { container } = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        fireEvent.error(coverImg(container)!);
        await waitFor(() => expect(head).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByTestId("cover-frame")).toBeNull();
    });

    it("本人のページだけ、真鍮の額縁を出して見出しを重ねる。押すとカバーの候補へ", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: ME } }) });
        profileResponse({ userId: ME, displayName: "旅人" });
        const { container } = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        // 読み込み中は出さない（ある人で一瞬出ない）
        expect(screen.queryByTestId("cover-frame")).toBeNull();
        fireEvent.error(coverImg(container)!);
        const frame = await screen.findByTestId("cover-frame");
        expect(frame.getAttribute("href")).toBe("/user/profile#cover-pick");
        expect(screen.getByRole("heading", { level: 1 }).closest("div[style*='padding-top']")).not.toBeNull();
    });

    it("カバーがあれば本人でも出さない", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: ME } }) });
        profileResponse({ userId: ME, displayName: "旅人" });
        const { container } = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        fireEvent.load(coverImg(container)!);
        await waitFor(() => expect(container.querySelector<HTMLElement>("[data-testid=profile-cover]")?.style.height).toBe("180px"));
        expect(screen.queryByTestId("cover-frame")).toBeNull();
    });

    it("ほかの人のページには出さない（黒のまま・板 31）", async () => {
        profileResponse({ userId: ME, displayName: "旅人" });
        const { container } = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        fireEvent.error(coverImg(container)!);
        await waitFor(() => expect(container.querySelector("[data-testid=profile-cover]")).toBeNull());
        expect(screen.queryByTestId("cover-frame")).toBeNull();
        // ほかの人のページでは HEAD も聞かない
        expect(head).not.toHaveBeenCalled();
    });
});

describe("カバー写真: 付く前に読み終えていた画像（静的HTMLに焼かれるページ）", () => {
    it("失敗し終えていたら帯を出さない・出せていたら広げる", async () => {
        profileResponse({ userId: ME, displayName: "旅人" });
        stubImage(true, 0);
        const a = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        expect(a.container.querySelector("[data-testid=profile-cover]")).toBeNull();
        a.unmount();
        stubImage(true, 1200);
        const b = render(<UserProfileClient userId={ME} />);
        await screen.findByRole("heading", { level: 1 });
        await waitFor(() => expect(b.container.querySelector<HTMLElement>("[data-testid=profile-cover]")?.style.height).toBe("180px"));
    });
});

describe("居住地", () => {
    it("「@名 · 居住地」の1行に出す", async () => {
        profileResponse({ userId: ME, displayName: "旅人", username: "tabibito", homeLocation: "札幌" });
        render(<UserProfileClient userId={ME} />);
        const line = await screen.findByTestId("profile-handle-line");
        await waitFor(() => expect(line.textContent).toContain("札幌"));
        expect(line.textContent).toContain("@tabibito");
        expect(line.textContent).toContain("居住地");
    });

    it("@名が無くても居住地だけ出す・どちらも無ければ行ごと出さない", async () => {
        profileResponse({ userId: ME, displayName: "旅人", homeLocation: "Lisbon" });
        const { unmount } = render(<UserProfileClient userId={ME} />);
        await waitFor(async () => expect((await screen.findByTestId("profile-handle-line")).textContent).toContain("Lisbon"));
        unmount();
        profileResponse({ userId: ME, displayName: "旅人" });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("旅人"));
        expect(screen.queryByTestId("profile-handle-line")).toBeNull();
    });
});
