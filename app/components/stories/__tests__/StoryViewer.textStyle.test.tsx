import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";
import type { StoryText } from "@/lib/utils/storyText";

/**
 * 置いた場所の文字を、見る側でも同じ場所に出す。
 *
 * owner:「インスタみたいにストーリーで好きな場所で文字打てるようにしたい」
 *
 * **下の帯には出さない**——同じ文言が写真の上と下に二重に出る。
 */
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import StoryViewer from "../StoryViewer";

const one: StoryText = { text: "朝の空", x: 0.25, y: 0.75, size: "s", font: "mincho", color: "pink", bg: "solid" };

function groups(over: { texts?: StoryText[]; caption?: string } = {}): StoryGroup[] {
    return [{
        userId: "owner", displayName: "丸田",
        items: [{
            id: "s1", src: "https://cdn/x/a.jpg", userId: "owner",
            caption: "朝の空", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2026-07-05T10:00:00Z",
            ...over,
        }],
    }];
}

function setup(over: { texts?: StoryText[]; caption?: string } = {}, ownUserId = "owner") {
    render(
        <StoryViewer
            groups={groups(over)} initialGroupIndex={0} locale="ja"
            ownUserId={ownUserId} isAuthenticated
            onSeen={vi.fn()} onDelete={vi.fn().mockResolvedValue(true)} onClose={vi.fn()}
        />,
    );
    const media = document.querySelector("img.story-media-in, video.story-media-in");
    if (media) fireEvent.load(media);
}

/** 写真の上に置いた文字（`translate` を持つ方） */
const placed = () => document.querySelector('p[style*="translate"]') as HTMLElement | null;

describe("StoryViewer: 置いた場所の文字", () => {
    it("置いた見せ方どおりに出す", () => {
        setup({ texts: [one] });
        const p = placed();
        expect(p, "置いた文字が出ていない").not.toBeNull();
        expect(p!.textContent).toBe("朝の空");
        expect(p!.style.left).toBe("25%");
        expect(p!.style.top).toBe("75%");
        expect(p!.style.fontFamily).toContain("Hiragino Mincho ProN");
        expect(p!.style.background).toBe("rgb(255, 100, 130)");   // pink の塗り
    });

    // 🔴 **二重に出さない。** 下の帯にも同じ文言が出ていた形を塞ぐ
    it("下の帯には同じ文言を出さない", () => {
        setup({ texts: [one] });
        expect(screen.getAllByText("朝の空"), "同じ文言が2か所に出ている").toHaveLength(1);
    });

    // **これまでの投稿は下の帯のまま**（見せ方を持たないストーリー）
    it("見せ方が無ければ、これまでどおり下の帯に出す", () => {
        setup({});
        expect(placed(), "見せ方が無いのに写真の上へ出している").toBeNull();
        expect(screen.getByText("朝の空")).toBeInTheDocument();
    });

    // 文字が1つも無ければ何も出さない（空の箱を描かない）
    it("文字が無ければ何も出さない", () => {
        setup({ texts: [], caption: undefined });
        expect(placed()).toBeNull();
    });

    // **並びが重なり順。** 複数置いたものを全部、その順で出す
    it("複数置いたものを、並びどおりに全部出す", () => {
        setup({ texts: [{ ...one, text: "いち" }, { ...one, text: "に", y: 0.3 }] });
        const ps = [...document.querySelectorAll('p[style*="translate"]')].map((e) => e.textContent);
        expect(ps).toEqual(["いち", "に"]);
    });

    // 他人のストーリーでも同じに出る（自分のときだけの飾りではない）
    it("他人のストーリーでも同じように出る", () => {
        setup({ texts: [one] }, "someone-else");
        expect(placed()?.textContent).toBe("朝の空");
        expect(screen.getAllByText("朝の空")).toHaveLength(1);
    });
});
