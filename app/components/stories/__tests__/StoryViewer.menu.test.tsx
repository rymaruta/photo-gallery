import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoryGroup } from "@/lib/stories";

/**
 * 最終版モック09 の「ストーリーコントロール」（⑦）と
 * 「プライバシー・報告オプション」（⑧）。
 *
 * **右上は「…」と「✕」の2つだけ。** 一時停止・ミュート・テキストの表示・
 * 削除・このユーザーを非表示・報告は、その「…」の1つの入口にまとめる
 * （以前は最大4つのアイコンが並び、投稿者が右上に置いた文字や投票と
 * 重なっていた）。
 *
 * 押しても何も起きない項目は出さない——音の無い写真に「ミュート」、
 * 文字の無い写真に「テキストを非表示」、自分のストーリーに
 * 「このユーザーを非表示」は置かない。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_r: unknown, f: string) => f,
    sessionErrorMessage: () => null,
}));
// 報告のダイアログは写真ページと同じ部品。トーストの入れ物はここでは持たない
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import StoryViewer from "../StoryViewer";

const ME = "me";
const story = (extra: Record<string, unknown> = {}) => ({
    id: "s1", src: "https://cdn/x/a.jpg", userId: "friend", mediaType: "image" as const,
    createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z", ...extra,
});
const theirs = (extra: Record<string, unknown> = {}): StoryGroup[] =>
    [{ userId: "friend", displayName: "友人", items: [story(extra)] }];
const mine = (extra: Record<string, unknown> = {}): StoryGroup[] =>
    [{ userId: ME, displayName: "自分", items: [story({ userId: ME, ...extra })] }];

const view = (groups: StoryGroup[], props: Partial<React.ComponentProps<typeof StoryViewer>> = {}) => {
    const onClose = vi.fn();
    const r = render(
        <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" isAuthenticated ownUserId={ME}
            onSeen={() => { /* noop */ }} onClose={onClose} {...props} />,
    );
    return { ...r, onClose };
};
const openMenu = async () => userEvent.click(await screen.findByLabelText("ストーリーの操作"));

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
    mockShowToast.mockReset();
});

describe("右上の並び（モック②）", () => {
    it("「…」と「✕」の2つだけ", async () => {
        view(theirs());
        const cluster = (await screen.findByLabelText("閉じる")).parentElement!;
        const labels = [...cluster.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
        expect(labels).toEqual(["ストーリーの操作", "閉じる"]);
    });
});

describe("操作シート（モック⑦⑧）", () => {
    it("他人のストーリー: 一時停止・このユーザーを非表示・報告が並ぶ", async () => {
        view(theirs());
        await openMenu();
        for (const name of ["一時停止", "このユーザーを非表示", "ストーリーを報告", "キャンセル"]) {
            expect(screen.getByRole("button", { name }), `${name} が無い`).toBeInTheDocument();
        }
    });

    it("自分のストーリーには「このユーザーを非表示」も「報告」も出ない", async () => {
        view(mine(), { onDelete: vi.fn() });
        await openMenu();
        expect(screen.queryByRole("button", { name: "このユーザーを非表示" })).toBeNull();
        expect(screen.queryByRole("button", { name: "ストーリーを報告" })).toBeNull();
        expect(screen.getByRole("button", { name: "ストーリーを削除" })).toBeInTheDocument();
    });

    // 押してから断られる形にしない（このリポジトリの決まり）
    it("未ログインには「このユーザーを非表示」も「報告」も出ない", async () => {
        view(theirs(), { isAuthenticated: false, ownUserId: null });
        await openMenu();
        expect(screen.queryByRole("button", { name: "このユーザーを非表示" })).toBeNull();
        expect(screen.queryByRole("button", { name: "ストーリーを報告" })).toBeNull();
        expect(screen.getByRole("button", { name: "一時停止" })).toBeInTheDocument();
    });

    it("シートの外を押すと閉じる", async () => {
        view(theirs());
        await openMenu();
        await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: "一時停止" })).toBeNull());
    });
});

describe("テキストを非表示（モック⑦）", () => {
    const withText = () => theirs({
        texts: [{ id: "t1", text: "この景色の前では、", x: 0.5, y: 0.4, size: 1, font: "sans", color: "white", bg: "none" }],
    });

    it("押すと写真の上の文字が消え、もう一度で戻る", async () => {
        view(withText());
        expect(await screen.findByText("この景色の前では、")).toBeInTheDocument();
        await openMenu();
        await userEvent.click(screen.getByRole("button", { name: "テキストを非表示" }));
        await waitFor(() => expect(screen.queryByText("この景色の前では、")).toBeNull());
        await openMenu();
        await userEvent.click(screen.getByRole("button", { name: "テキストを表示" }));
        expect(await screen.findByText("この景色の前では、")).toBeInTheDocument();
    });

    it("キャプションだけの投稿でも効く", async () => {
        view(theirs({ caption: "夕暮れの港" }));
        expect(await screen.findByText("夕暮れの港")).toBeInTheDocument();
        await openMenu();
        await userEvent.click(screen.getByRole("button", { name: "テキストを非表示" }));
        await waitFor(() => expect(screen.queryByText("夕暮れの港")).toBeNull());
    });

    it("文字の無い写真には項目ごと出ない", async () => {
        view(theirs());
        await openMenu();
        expect(screen.queryByRole("button", { name: /テキストを/ })).toBeNull();
    });
});

describe("このユーザーを非表示（モック⑧）", () => {
    it("ブロックして、効いたらこの画面を閉じる", async () => {
        const { onClose } = view(theirs());
        await openMenu();
        await userEvent.click(screen.getByRole("button", { name: "このユーザーを非表示" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/users/friend/block", { method: "POST" }));
        await waitFor(() => expect(onClose, "非表示にした相手のストーリーが目の前に残る").toHaveBeenCalled());
    });

    // 失敗を成功に見せない（押したのにまた出てくる、の二度目の落胆を作らない）
    it("断られたら閉じない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { onClose } = view(theirs());
        await openMenu();
        await userEvent.click(screen.getByRole("button", { name: "このユーザーを非表示" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 20));
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe("ストーリーを報告（モック⑧）", () => {
    it("写真ページと同じ報告のダイアログを、そのストーリーの id で開く", async () => {
        view(theirs());
        await openMenu();
        await userEvent.click(screen.getByRole("button", { name: "ストーリーを報告" }));
        // 理由の一覧（`REPORT_REASON_LABELS`）が出る
        expect(await screen.findByText("広告・勧誘・スパム")).toBeInTheDocument();
        await userEvent.click(screen.getByText("広告・勧誘・スパム"));
        await userEvent.click(screen.getByRole("button", { name: "通報する" }));
        await waitFor(() => expect(
            mockUserFetch.mock.calls.some((c) => String(c[0]) === "/photos/s1/report"),
            "そのストーリーの id で報告していない",
        ).toBe(true));
    });
});
