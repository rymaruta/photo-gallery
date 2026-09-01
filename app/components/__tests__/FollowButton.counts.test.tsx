import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **「まだ分からない」と「0人」を混ぜていた。**
//
// 数は共有ストアから `?? EMPTY`（0/0）で読んでいたので、取得が落ちた人の
// プロフィールは「フォロワー 0 / フォロー中 0」と**言い切って**いた。
// 失敗の印も再試行の導線も無く、本当に0人の人と区別が付かない。
// この画面には読み込み中の表示が無いので、分かるまで出さずに待つ。

const mockUserPublicFetch = vi.hoisted(() => vi.fn());
// 実物を土台にする（列挙だけだと、実装が新しく使う export が undefined に
// なって投げ、catch が飲む＝緑のまま何も測らないテストになる）
vi.mock("../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/utils/api")>()),
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ userIds: [] }) })),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    publicFetch: vi.fn(),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const TARGET = "44444444-4444-4444-8444-444444444444";

beforeEach(async () => {
    vi.resetModules();
    mockUserPublicFetch.mockReset();
});

/** ストアはモジュール内に持たれるので、毎回読み込み直す */
async function renderButton() {
    const mod = await import("../FollowButton");
    const FollowButton = mod.default;
    render(<FollowButton targetUserId={TARGET} isAuthenticated={false} locale="ja" />);
}

describe("フォロー数のピル", () => {
    it("取得に失敗したら数を出さない（0と言い切らない）", async () => {
        mockUserPublicFetch.mockRejectedValue(new Error("network"));
        await renderButton();

        // 取得の失敗が確定するまで待つ
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 20));

        expect(screen.queryByText("フォロワー"), "取れていないのに「0」と言い切っている").toBeNull();
        expect(screen.queryByText("フォロー中")).toBeNull();
    });

    it("取得できたら数を出す（正常系）", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 501, following: 87 }) });
        await renderButton();

        expect(await screen.findByText("フォロワー")).toBeInTheDocument();
        expect(screen.getByText("501")).toBeInTheDocument();
        expect(screen.getByText("87")).toBeInTheDocument();
    });

    it("本当に0人なら0を出す（未取得と混ぜない）", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 0, following: 0 }) });
        await renderButton();

        expect(await screen.findByText("フォロワー")).toBeInTheDocument();
        expect(screen.getAllByText("0")).toHaveLength(2);
    });
});
