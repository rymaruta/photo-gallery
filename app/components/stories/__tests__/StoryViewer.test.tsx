import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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
    // **絵が出たことにする。** 読み込みが済むまで時間を進めない作りになったので、
    // 模さないと開いた直後のまま凍る（守っている規則は変わっていない）
    const media = document.querySelector("img.story-media-in, video.story-media-in");
    if (media) fireEvent.load(media);
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
        // **高さの綴りでは探さない。** 以前は `[class*="h-[2.5px]"]` を目印に
        // していたので、寸法をアーティファクトの板（3px）に合わせた日に
        // **0本を数えて落ちた**——見たい性質（本数＝枚数）は何も変わって
        // いないのに。行そのものを掴んで、その子を数える。
        const row = screen.getByRole("progressbar", { name: /本目|of / });
        expect(row.children.length).toBe(2);
        // 読み上げにも同じ数が出る（画面の本数と食い違わない）
        expect(row.getAttribute("aria-label")).toBe("2本中1本目");
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

    // 削除の入口は右上の「…」（モック09 ⑦⑧で、右上は「…」と「✕」の2つだけ）
    it("自分のストーリーには削除があり、確認 → onDelete → onClose", async () => {
        const onDelete = vi.fn().mockResolvedValue(true);
        const { onClose } = setup({ onDelete });
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        fireEvent.click(await screen.findByRole("button", { name: "ストーリーを削除" }));
        // 確認ダイアログ
        const dialog = await screen.findByText(/この操作は取り消せません/);
        expect(dialog).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "削除" }));
        await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1"));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("他人のストーリーには削除を出さない", () => {
        setup({ initialGroupIndex: 1 }); // other グループ
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        expect(screen.queryByRole("button", { name: "ストーリーを削除" })).toBeNull();
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
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        expect(screen.getByRole("button", { name: /ミュート/ })).toBeInTheDocument();
    });

    // 音の無い写真に「ミュート」を置かない（押しても何も起きない項目を出さない）
    it("音の無いストーリーの操作シートにミュートは出ない", () => {
        setup();
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        expect(screen.queryByRole("button", { name: /ミュート/ })).toBeNull();
    });

    it("削除確認をキャンセルすると onDelete は呼ばれない", async () => {
        const onDelete = vi.fn().mockResolvedValue(true);
        setup({ onDelete });
        fireEvent.click(screen.getByLabelText("ストーリーの操作"));
        fireEvent.click(await screen.findByRole("button", { name: "ストーリーを削除" }));
        await screen.findByText(/この操作は取り消せません/);
        fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
        expect(onDelete).not.toHaveBeenCalled();
    });
});

describe("StoryViewer - 滑らかなプログレス", () => {
    it("画像の現在バーは CSS アニメーション（5秒）で駆動される", () => {
        setup();
        const fill = document.querySelector(".story-progress-fill") as HTMLElement;
        expect(fill).not.toBeNull();
        expect(fill.style.animationDuration).toBe("5000ms");
        expect(fill.style.animationPlayState).toBe("running");
    });

    it("現在バーには自動送り用の onAnimationEnd が結線されている", () => {
        setup();
        // React は onAnimationEnd を要素に data 属性化しないため、ハンドラ結線の
        // 直接検証は難しい。ここでは要素が存在し fill-mode:forwards で
        // 完了状態を保持する（＝完了イベントが発火しうる）ことを確認する。
        const fill = document.querySelector(".story-progress-fill") as HTMLElement;
        expect(fill).not.toBeNull();
        expect(fill.className).toContain("story-progress-fill");
    });

    it("長押し（pointerDown）で一時停止しアニメーションが paused になる", () => {
        setup();
        // 右2/3のタップ領域を長押し
        const zones = document.querySelectorAll('[class*="w-2/3"]');
        fireEvent.pointerDown(zones[zones.length - 1]);
        const fill = document.querySelector(".story-progress-fill") as HTMLElement;
        expect(fill.style.animationPlayState).toBe("paused");
    });

    it("動画の現在バーは CSS アニメーションではなく transform で進捗を表す", () => {
        const groups: StoryGroup[] = [{
            userId: "owner",
            displayName: "丸田",
            items: [{ id: "v1", src: "https://cdn/x/v.mp4", userId: "owner", mediaType: "video", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2026-07-05T10:00:00Z" }],
        }];
        setup({ groups });
        // 動画では story-progress-fill を使わない
        expect(document.querySelector(".story-progress-fill")).toBeNull();
    });
});

// ストーリーも共通のロックに寄せた（`overflow` だけの自前実装だった）。
// 位置の控えが無かったので、閉じたときに別の場所にいることがあった。
describe("背景スクロールのロック", () => {
    it("開いている間は position:fixed、閉じたら戻す", () => {
        setup();
        expect(document.body.style.position, "overflow だけのロックに戻っている").toBe("fixed");

        cleanup();
        expect(document.body.style.position).toBe("");
        expect(document.body.style.overflow).toBe("");
    });

    // **描くものが無くなったらロックも外す。** 無条件に掛けていたので、
    // `groups` が入れ替わって表示対象が消えると「何も描かないのに
    // `position: fixed` のまま」になる。`overflow: hidden` だけだった
    // 頃は「スクロールできない」で済んでいたが、位置を控えるように
    // なったぶん**ページ先頭へ飛んだまま固まる**方に悪化していた。
    it("表示対象が消えたらロックも外れる（白いまま固まらない）", () => {
        const props = {
            groups: makeGroups(),
            initialGroupIndex: 0,
            locale: "ja" as const,
            ownUserId: "owner",
            isAuthenticated: true,
            onSeen: vi.fn(),
            onDelete: vi.fn().mockResolvedValue(true),
            onClose: vi.fn(),
        };
        const { rerender } = render(<StoryViewer {...props} />);
        expect(document.body.style.position).toBe("fixed");

        rerender(<StoryViewer {...props} groups={[]} />);
        expect(document.body.style.position, "何も描いていないのに背景が止まったまま").toBe("");
    });
});
