import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 投稿プレビューは `fixed inset-0 z-[95]` の全画面で、裏にはストーリーの
// リングとギャラリーの写真リンクが全部ある。`aria-modal="true"` と言いながら
// Tab で外へ出られた（`aria-modal` を持つ8つのうち、ここと StoryViewer
// だけ管理が無かった）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

// 画像の縮小は canvas を使うので jsdom では通らない。
// ここは「保存に失敗したあとの後始末」を見るテストなので素通しにする。
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));

import StoriesBar from "../StoriesBar";

const KEY = "uploads/me/story.jpg";
const PUBLIC_URL = `https://cdn.example.com/${KEY}`;

/** presign と S3 の PUT を成功させる既定の応答（保存の結果は呼び出し側で差し替える） */
function api() {
    return (url: string) => {
        if (url === "/stories") {
            // 一覧の取得（GET）は空で返す
            return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }),
            });
        }
        if (url === "/user/profile") return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({}) });
    };
}

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockImplementation(api());
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

const tab = (shift = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey: shift });

/** 「あなた」からファイルを選んで下書きを開く */
async function openDraft() {
    const { container } = render(
        <div>
            <button>裏のリンク</button>
            <StoriesBar />
        </div>,
    );
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "story.jpg", { type: "image/jpeg" }));
    return screen.findByRole("dialog");
}

describe("ストーリーの投稿プレビュー: Tab が外へ漏れない", () => {
    // **「開いた瞬間に中へ入る」はここでは主張しない。**
    // この下書き画面は、開いた時点では中身がまだ描かれていない
    // （フックが走るとき押せる要素は0で、容器に `tabIndex=-1` が付くところまでは
    // 実測できる）。あとからファイル入力へフォーカスが戻る経路もある。
    // フックが保証するのは「Tab を押したら中に入る／外へ出ない」までなので、
    // ここではそれを見る。**開いた瞬間の位置は別の穴として台帳に残した。**

    it("裏のボタンにフォーカスを当てて Tab すると、中へ引き戻す", async () => {
        const dialog = await openDraft();
        screen.getByText("裏のリンク").focus();
        tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("最後の要素から Tab すると中の先頭へ戻る", async () => {
        const dialog = await openDraft();
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        expect(items.length).toBeGreaterThan(1);
        items[items.length - 1].focus();
        tab();
        expect(document.activeElement).toBe(items[0]);
    });

    // 読み上げで「何のダイアログか」が分かるように（見出しと結ぶ）
    it("ダイアログに名前がある", async () => {
        const dialog = await openDraft();
        expect(dialog).toHaveAccessibleName("新しいストーリー");
    });
});
