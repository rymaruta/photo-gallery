import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// api の動的 import は閲覧記録・閲覧者取得で使われるが、テストでは失敗しても
// 握りつぶされる（描画・操作には影響しない）。log だけ黙らせる。
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import StoryViewer from "../StoryViewer";

function makeGroups(): StoryGroup[] {
    return [
        {
            userId: "owner",
            displayName: "丸田",
            items: [
                { id: "s1", src: "https://cdn/x/a.jpg", userId: "owner", caption: "1枚目", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2026-07-05T10:00:00Z" },
                { id: "s2", src: "https://cdn/x/b.jpg", userId: "owner", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2026-07-05T11:00:00Z" },
            ],
        },
        {
            userId: "other",
            displayName: "B子",
            items: [
                { id: "s3", src: "https://cdn/x/c.jpg", userId: "other", createdAt: "2026-07-04T09:00:00Z", expiresAt: "2026-07-05T09:00:00Z" },
            ],
        },
    ];
}

function setup(over: Partial<React.ComponentProps<typeof StoryViewer>> = {}) {
    const props = {
        groups: makeGroups(),
        initialGroupIndex: 0,
        locale: "ja" as const,
        ownUserId: "owner",
        isAuthenticated: true,
        onSeen: vi.fn(),
        onDelete: vi.fn().mockResolvedValue(true),
        onClose: vi.fn(),
        ...over,
    };
    render(<StoryViewer {...props} />);
    return props;
}

beforeEach(() => vi.clearAllMocks());

describe("StoryViewer", () => {
    it("先頭グループの1枚目メディアとキャプションを表示する", () => {
        setup();
        // alt="" の img は role を持たないため src で確認（本体 + アンビエント背景）
        const imgs = Array.from(document.body.querySelectorAll("img")).filter((el) => el.src.includes("a.jpg"));
        expect(imgs.length).toBeGreaterThan(0);
        expect(screen.getByText("1枚目")).toBeInTheDocument();
    });

    it("プログレスバーの本数はグループ内の枚数と一致する", () => {
        setup();
        // 先頭グループは2枚 → セグメント2本（h-[2.5px] のトラック）
        const segments = document.body.querySelectorAll('[class*="h-[2.5px]"]');
        expect(segments.length).toBe(2);
    });

    it("表示中のストーリーを onSeen で通知する", () => {
        const { onSeen } = setup();
        expect(onSeen).toHaveBeenCalledWith("s1");
    });

    it("閉じるボタンで onClose を呼ぶ", () => {
        const { onClose } = setup();
        fireEvent.click(screen.getByLabelText("閉じる"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("→キーで次のストーリーに進む（キャプションが消える=2枚目へ）", () => {
        setup();
        expect(screen.getByText("1枚目")).toBeInTheDocument();
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(screen.queryByText("1枚目")).toBeNull();
    });

    it("自分のストーリーには削除ボタンがあり、確認 → onDelete → onClose", async () => {
        const onDelete = vi.fn().mockResolvedValue(true);
        const { onClose } = setup({ onDelete });
        fireEvent.click(screen.getByLabelText("ストーリーを削除"));
        // 確認ダイアログ
        const dialog = await screen.findByText("このストーリーを削除しますか？");
        expect(dialog).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "削除" }));
        await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1"));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("他人のストーリーには削除ボタンを出さない", () => {
        setup({ initialGroupIndex: 1 }); // other グループ
        expect(screen.queryByLabelText("ストーリーを削除")).toBeNull();
    });

    it("自分のストーリーには閲覧者ピルを表示する", () => {
        setup();
        expect(screen.getByLabelText("閲覧者を見る")).toBeInTheDocument();
    });

    it("他人のストーリーには閲覧者ピルを出さない", () => {
        setup({ initialGroupIndex: 1 });
        expect(screen.queryByLabelText("閲覧者を見る")).toBeNull();
    });

    it("動画ストーリーではミュート切り替えボタンを表示する", () => {
        const groups: StoryGroup[] = [{
            userId: "owner",
            displayName: "丸田",
            items: [{ id: "v1", src: "https://cdn/x/v.mp4", userId: "owner", mediaType: "video", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2026-07-05T10:00:00Z" }],
        }];
        setup({ groups });
        expect(screen.getByLabelText(/ミュート/)).toBeInTheDocument();
    });

    it("削除確認をキャンセルすると onDelete は呼ばれない", async () => {
        const onDelete = vi.fn().mockResolvedValue(true);
        setup({ onDelete });
        fireEvent.click(screen.getByLabelText("ストーリーを削除"));
        await screen.findByText("このストーリーを削除しますか？");
        fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
        expect(onDelete).not.toHaveBeenCalled();
    });
});
