import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoryGroup } from "@/lib/stories";

// **このサイトにしかない向き。** Instagram は「投稿 → ストーリーへシェア」
// しか持っていない。ここは逆で、24時間で消えるものを**検索に出る写真**にする。
// できるのは**下書き**なので、黙って検索に出ることはない。

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_res: unknown, fallback: string) => fallback,
    sessionErrorMessage: () => null,
}));

import StoryViewer from "../StoryViewer";

const own = (extra: Record<string, unknown> = {}): StoryGroup[] => [{
    userId: "me",
    displayName: "自分",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "me", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z", ...extra },
        { id: "s2", src: "https://cdn/x/b.jpg", userId: "me", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z" },
    ],
}];

// **キャプションを持たせる。** 下の段は `(isOwnStory || item.caption)` で
// 出るので、キャプションが無い他人のストーリーでは段ごと描かれない
// ——`isOwnStory` の判定を消しても「ボタンが無い」ことになり、
// **何も検証していないテスト**になる（変異で実際に素通りした）
const others = (): StoryGroup[] => [{
    userId: "friend", displayName: "友人",
    items: [{ id: "f1", src: "https://cdn/x/c.jpg", userId: "friend", caption: "友人のキャプション", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" }],
}];

const view = (groups: StoryGroup[], props: Partial<React.ComponentProps<typeof StoryViewer>> = {}) => render(
    <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" isAuthenticated ownUserId="me"
        onSeen={() => { /* noop */ }} onClose={() => { /* noop */ }} {...props} />,
);

const keepPosts = () => mockUserFetch.mock.calls.filter(
    (c) => String(c[0]).includes("/keep") && (c[1] as { method?: string })?.method === "POST");

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("ストーリーをギャラリーに残す", () => {
    it("押すと、そのストーリーを残しにいく", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: true, json: async () => ({ photoId: "p-1" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        expect(keepPosts()[0][0]).toBe("/stories/s1/keep");
    });

    // **仕上げへ誘う。** 残しただけでは下書きで、撮影地も題も無い
    // ——そのままでは検索の価値が無い
    it("残したら、編集画面への導線に変わる", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: true, json: async () => ({ photoId: "p-1" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        const link = await screen.findByText(/残した/);
        expect(link.closest("a")?.getAttribute("href")).toBe("/user/edit?id=p-1");
    });

    // 既に残してあるストーリーを開き直したとき（サーバーが `keptAs` を返す）
    it("既に残してあれば、最初から導線を出す", async () => {
        view(own({ keptAs: "p-9" }));
        const link = await screen.findByText(/残した/);
        expect(link.closest("a")?.getAttribute("href")).toBe("/user/edit?id=p-9");
        expect(screen.queryByLabelText("ギャラリーに残す"), "残してあるのに押させている").toBeNull();
    });

    // 写真の行は画像が前提（サムネも AVIF も sharp が作る）
    it("動画には出さない", async () => {
        view(own({ mediaType: "video" }));
        await screen.findByLabelText("閉じる");
        expect(screen.queryByLabelText("ギャラリーに残す")).toBeNull();
    });

    it("他人のストーリーには出さない", async () => {
        view(others());
        // 段そのものは出ている（キャプションがある）ことを先に確かめる
        expect(await screen.findByText("友人のキャプション")).toBeInTheDocument();
        expect(screen.queryByLabelText("ギャラリーに残す"), "他人の写真を自分のギャラリーに入れられる").toBeNull();
    });

    it("失敗したら理由を出す（残したことにしない）", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(screen.queryByText(/残した/), "失敗したのに残したと出ている").toBeNull();
    });

    // **応答を待っている間は進めない。** 進むと、残した手応えが別の1枚に出る
    it("残している間は自動で進まない", async () => {
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                await held;
                return { ok: true, json: async () => ({ photoId: "p-1" }) };
            }
            return { ok: true, json: async () => ({}) };
        });
        view(own());
        fireEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(
            (document.querySelector(".story-progress-fill") as HTMLElement | null)?.style.animationPlayState,
            "応答を待っている間も進んでいる",
        ).toBe("paused"));
        release();
    });

    it("待っている間に手で次へ進めたら、その1枚に手応えを出さない", async () => {
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                await held;
                return { ok: true, json: async () => ({ photoId: "p-1" }) };
            }
            return { ok: true, json: async () => ({}) };
        });
        view(own());
        fireEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        fireEvent.keyDown(document, { key: "ArrowRight" });
        release();
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.queryByText(/残した/), "別の1枚に手応えが出ている").toBeNull();
    });
});
