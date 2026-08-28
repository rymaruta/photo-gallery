import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// `aria-modal="true"` を付けたモーダルは8つあり、そのうちこの2つだけ
// フォーカス管理が無かった（StoryViewer は `focus`/`tabIndex` の grep が0件）。
// どちらも全画面で、裏にはギャラリーの写真リンクが全部ある。

vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, userId: "me" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../music/MusicContext", () => ({ useMusic: () => ({ stop: vi.fn(), pause: vi.fn(), play: vi.fn(), playing: false }) }));

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: mockUserFetch, userPublicFetch: vi.fn(), publicFetch: vi.fn(), authenticatedFetch: vi.fn() };
});

const StoryViewer = (await import("../StoryViewer")).default;

const story = {
    id: "s1", src: "https://cdn/a.jpg", userId: "u2", displayName: "旅人A",
    createdAt: "2098-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
};
const groups = [{ userId: "u2", displayName: "旅人A", items: [story] }];

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ viewers: [] }) });
});

function setup() {
    return render(
        <div>
            <button>裏のリンク</button>
            <StoryViewer
                groups={groups as never}
                initialGroupIndex={0}
                locale="ja"
                ownUserId="u2"
                isAuthenticated
                onSeen={vi.fn()}
                onDelete={vi.fn(async () => true)}
                onClose={vi.fn()}
            />
        </div>,
    );
}

const tab = (shift = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey: shift });

describe("StoryViewer: Tab が外へ漏れない", () => {
    it("開いたら閉じるボタンにフォーカスが入る（破壊的な操作を先頭にしない）", async () => {
        setup();
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByLabelText("閉じる"));
        });
    });

    it("最後の要素から Tab すると中の先頭へ戻る", async () => {
        setup();
        const dialog = screen.getByRole("dialog");
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        expect(items.length).toBeGreaterThan(1);

        items[items.length - 1].focus();
        tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).toBe(items[0]);
    });

    it("裏のボタンにフォーカスを当てて Tab すると、中へ引き戻す", async () => {
        setup();
        screen.getByText("裏のリンク").focus();
        tab();
        expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });
});
