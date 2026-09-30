// @vitest-environment jsdom
// ↑ happy-dom では結果が変わる（2026-09-30 の切り替えで落ちたもの）。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// **写真が取れなかったストーリーが、真っ黒のまま待たされていた。**
//
// 同じ場所の `<video>` には `onError={goNext}` があるのに、`<img>` には
// 何も無かった。`alt=""` の画像は失敗すると 0x0 に潰れるので、削除・
// 期限切れの掃除の直後や `uploads/` の 403 では、進捗バーだけが進む
// 黒い画面を表示秒数（最大15秒）ぶん見せられる。
//
// **飛ばす（goNext）方には倒さない**——1枚しか無いストーリーだと開いた
// 瞬間に閉じ、リングを押しても何も起きないように見えるため。理由を出す。

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import StoryViewer from "../StoryViewer";

const groups = (): StoryGroup[] => [{
    userId: "owner",
    displayName: "丸田",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "owner", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" },
        { id: "s2", src: "https://cdn/x/b.jpg", userId: "owner", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z" },
    ],
}];

function setup(over: Partial<React.ComponentProps<typeof StoryViewer>> = {}) {
    const props = {
        groups: groups(),
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

/** 本体の画像（アンビエント背景ではない方）。`alt=""` なので src で拾う */
const mainImage = (file: string) =>
    Array.from(document.body.querySelectorAll("img")).filter((el) => el.getAttribute("src")?.includes(file));

describe("ストーリーの写真が取れなかったとき", () => {
    it("理由を出す（真っ黒のまま待たせない）", () => {
        const props = setup();
        const imgs = mainImage("a.jpg");
        expect(imgs.length).toBeGreaterThan(0);
        fireEvent.error(imgs[imgs.length - 1]);

        expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();
        // 勝手に飛ばさない・閉じない（1枚しか無い人のリングが「無反応」に見える）
        expect(props.onClose).not.toHaveBeenCalled();
    });

    // **控えも捨てる。** ストーリーは開いた瞬間に取りに行くので、
    // キャプティブポータル（ホテル・空港の Wi-Fi）に当たりやすい。
    // 控えが毒を食うと、SW はキャッシュ優先・寿命なしなので**再読込しても
    // 割れたまま**——別オリジンの写真は opaque で SW 側では弾けない
    it("読み込めなかった写真の控えを捨てる", async () => {
        const deleted: string[] = [];
        const opened: string[] = [];
        vi.stubGlobal("caches", {
            open: async (name: string) => {
                opened.push(name);
                return { delete: async (u: string) => { deleted.push(u); return true; } };
            },
        });
        setup();
        fireEvent.error(mainImage("a.jpg").at(-1)!);
        await Promise.resolve();
        await Promise.resolve();

        expect(opened, "違う入れ物を開いている").toEqual(["journey-photo-img-v1"]);
        expect(deleted).toEqual(["https://cdn/x/a.jpg"]);
    });

    it("次のストーリーへ進むと元に戻る（1枚の失敗を持ち越さない）", () => {
        setup();
        fireEvent.error(mainImage("a.jpg").at(-1)!);
        expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(screen.queryByText("画像を読み込めません"),
            "1枚失敗しただけで、以降が全部「読み込めません」になっている").toBeNull();
        expect(mainImage("b.jpg").length).toBeGreaterThan(0);
    });

    // **左タップ（今の1枚を最初から）で読み直せる。**
    // リセットの deps から `replay` を落としても3件が緑のままだった
    // ＝「同じ1枚をタップで読み直す」経路が無検証だった（レビュー指摘）
    it("左タップで読み直すと、失敗表示が消えて画像に戻る", () => {
        setup();
        fireEvent.error(mainImage("a.jpg").at(-1)!);
        expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();

        // 「始まってから 0.8 秒以内の左タップ」は前へ戻るので、時間を進めて
        // から押す（`restart` の側に入れる）
        const now = Date.now();
        const spy = vi.spyOn(Date, "now").mockReturnValue(now + 5000);
        try {
            fireEvent.keyDown(document, { key: "ArrowLeft" });
        } finally {
            spy.mockRestore();
        }

        expect(screen.queryByText("画像を読み込めません"),
            "左タップで読み直せない（同じ1枚に張り付いたまま）").toBeNull();
        expect(mainImage("a.jpg").length).toBeGreaterThan(0);
    });

    // **動画は飛ばす側で正しい。** 読み込めなかった動画は `duration` が NaN で
    // 進捗バーが1ミリも進まず `onEnded` も来ないので、`onError={goNext}` が
    // 唯一の出口。この行を外すと永久に固まる（テストが無かった）
    it("動画が読み込めないときは次へ送る（固まらせない）", () => {
        const props = setup({
            groups: [{
                userId: "owner",
                displayName: "丸田",
                items: [
                    { id: "v1", src: "https://cdn/x/a.mp4", mediaType: "video", userId: "owner", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" },
                    { id: "s2", src: "https://cdn/x/b.jpg", userId: "owner", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z" },
                ],
            }],
        });
        const video = document.body.querySelector("video");
        expect(video).not.toBeNull();
        fireEvent.error(video!);

        expect(mainImage("b.jpg").length, "動画の失敗で止まったまま").toBeGreaterThan(0);
        expect(props.onClose).not.toHaveBeenCalled();
    });

    // 正常系: 出せる写真はこれまでどおり
    it("読み込める写真では何も出さない", () => {
        setup();
        expect(screen.queryByText("画像を読み込めません")).toBeNull();
        expect(mainImage("a.jpg").length).toBeGreaterThan(0);
    });
});

afterEach(() => { vi.unstubAllGlobals(); });
