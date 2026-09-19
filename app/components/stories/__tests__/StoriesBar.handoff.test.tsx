import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// 「＋」（`PostFab`）で選んだファイルを、バーが受け取って投稿の流れ（下書き
// プレビュー）へ乗せる。バーが描かれていればその場で、別のページで選ばれた
// ぶんはトップへ移ってきたマウント時に（`lib/utils/storyHandoff.ts`）

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, userId: "me" }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_r: Response, fallback: string) => fallback,
}));
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));

import StoriesBar from "../StoriesBar";
import { handOffStoryFile, resetStoryHandoff } from "../../../../lib/utils/storyHandoff";

beforeEach(() => {
    resetStoryHandoff();
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ groups: [] }) });
    document.body.innerHTML = "";
});

const draft = () => screen.queryByRole("dialog", { name: /ストーリー/ });

describe("StoriesBar が「＋」からのファイルを受け取る", () => {
    it("描かれている間に渡されたら、その場で下書きを開く", async () => {
        render(<StoriesBar />);
        expect(draft()).toBeNull();
        const took = handOffStoryFile(new File(["x"], "s.jpg", { type: "image/jpeg" }));
        expect(took, "バーが居るのに受け取っていない").toBe(true);
        await waitFor(() => expect(draft()).toBeInTheDocument());
    });

    it("預けられていたぶんは、マウント時に受け取る（別のページで選んだ場合）", async () => {
        expect(handOffStoryFile(new File(["x"], "s.jpg", { type: "image/jpeg" }))).toBe(false);
        render(<StoriesBar />);
        await waitFor(() => expect(draft()).toBeInTheDocument());
    });

    // 外れたら受け取らない。残ると「受け取った」と答えるのに何も出ず、
    // `PostFab` はトップへ移らない＝ファイルが黙って消える
    it("外れたあとは受け取らない（購読の解除）", () => {
        const { unmount } = render(<StoriesBar />);
        unmount();
        expect(handOffStoryFile(new File(["x"], "s.jpg", { type: "image/jpeg" })), "外れたバーが受け取っている").toBe(false);
    });

    it("受け取った中身も、入力欄から選んだときと同じ関門を通る", async () => {
        render(<StoriesBar />);
        handOffStoryFile(new File(["x"], "s.txt", { type: "text/plain" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(String(mockShowToast.mock.calls[0][0])).toMatch(/写真または動画/);
        expect(draft()).toBeNull();
    });
});
