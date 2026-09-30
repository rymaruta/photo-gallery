// @vitest-environment jsdom
// ↑ happy-dom では写真の <img> が alt で見つからない（描かれ方が違う。原因は未調査）。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **タブを横スワイプすると、写真ページへも飛んでいた。**
//
// 写真のセルは全面が `<Link>`。グリッドの上で横スワイプすると、タブが
// 切り替わると同時に `click` が発火して遷移する（1セル約126px に対して
// スワイプ判定は45pxなので、セル1つの中で成立する）。`click` は指を離せば
// 必ず飛ぶ——`StoryViewer` は同じ現象を観測して `wasTap()` で塞いだのに、
// こちらには歯止めが無かった。
//
// 既存の `UserProfileClient.swipe.test.tsx` は**写真0件**でしか回っておらず、
// この経路を一度も踏んでいない。

const mockPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn().mockResolvedValue(null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: vi.fn().mockResolvedValue({ ok: false }),
        userPublicFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userId: OWNER }) }),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../data/photos.json", () => ({ default: [] }));

const OWNER = "55555555-5555-4555-8555-555555555555";

import UserProfileClient from "../UserProfileClient";

const photo = (id: string) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id,
    category: "travel", tags: [], date: "2026-01-0" + id.slice(-1), createdAt: "2026-01-01", published: true,
});

beforeEach(() => {
    mockPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => [photo("p1"), photo("p2"), photo("p3")],
    });
});

/**
 * グリッドの上で横スワイプする（写真セルの中で完結する移動量）。
 *
 * **右へ払う。** 左だと投稿タブ → 年表タブに切り替わってグリッドごと
 * 消えるので、「そのあと写真のリンクが押される」という**本来の筋道**を
 * 再現できない（端にいるときの右払いはタブが動かないだけで、スワイプの
 * 判定自体は成立する＝click を食う条件も同じ）。
 */
function swipeOverGrid(area: HTMLElement) {
    fireEvent.pointerDown(area, { clientX: 130, clientY: 300 });
    fireEvent.pointerUp(area, { clientX: 200, clientY: 306 });
}

describe("写真グリッドの上での横スワイプ", () => {
    it("スワイプの直後の click は食う（写真ページへ飛ばない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getAllByAltText(/p\d/).length).toBeGreaterThan(0));

        const area = screen.getByTestId("tab-swipe-area");
        const link = screen.getAllByAltText(/p\d/)[0].closest("a") as HTMLAnchorElement;

        swipeOverGrid(area);
        // 指を離したあとブラウザが投げる click（写真のリンクへ）
        const clicked = fireEvent.click(link, { bubbles: true, cancelable: true });

        // fireEvent は preventDefault されると false を返す
        expect(clicked, "スワイプの直後の click が素通りしている（写真ページへ飛ぶ）").toBe(false);
    });

    it("スワイプしていなければ、写真のリンクは普通に押せる", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getAllByAltText(/p\d/).length).toBeGreaterThan(0));

        const link = screen.getAllByAltText(/p\d/)[0].closest("a") as HTMLAnchorElement;
        expect(fireEvent.click(link, { bubbles: true, cancelable: true }),
            "普通のタップまで潰している").toBe(true);
    });

    it("食うのは1回だけ（次のタップは通る）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getAllByAltText(/p\d/).length).toBeGreaterThan(0));

        const area = screen.getByTestId("tab-swipe-area");
        const link = screen.getAllByAltText(/p\d/)[0].closest("a") as HTMLAnchorElement;

        swipeOverGrid(area);
        fireEvent.click(link, { bubbles: true, cancelable: true });
        expect(fireEvent.click(link, { bubbles: true, cancelable: true }),
            "2回目のタップまで潰している").toBe(true);
    });
});

// **札が立ちっぱなしになる経路。** 札を下ろすのは click と pointercancel
// だけだったので、click が来なければ次のタップまで残る。左スワイプでは
// タブが切り替わって押していた写真のセルが DOM から消えるため、
// ブラウザは click を投げない（＝「1回目のタップが効かない」）。
describe("タブが実際に切り替わったあと（左スワイプ）", () => {
    it("次のタップは飲まれない", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getAllByAltText(/p\d/).length).toBeGreaterThan(0));

        const area = screen.getByTestId("tab-swipe-area");
        // 左へ払う＝投稿タブ → 年表タブ。グリッドごと消えるので click は来ない
        fireEvent.pointerDown(area, { clientX: 200, clientY: 300 });
        fireEvent.pointerUp(area, { clientX: 130, clientY: 306 });
        // 年表タブに入ったことを、年表側にしか出ない月ラベルで確かめる
        //（写真そのものは年表にも並ぶので alt では見分けられない）
        await screen.findByText(/2026年1月/);

        // 右へ払って投稿タブに戻す（こちらも click は来ない）
        fireEvent.pointerDown(area, { clientX: 130, clientY: 300 });
        fireEvent.pointerUp(area, { clientX: 200, clientY: 306 });
        await waitFor(() => expect(screen.queryByText(/2026年1月/)).toBeNull());

        // ここでの普通のタップ（写真を開く）は通らないといけない
        const link = screen.getAllByAltText(/p\d/)[0].closest("a") as HTMLAnchorElement;
        fireEvent.pointerDown(link, { clientX: 100, clientY: 300 });
        fireEvent.pointerUp(link, { clientX: 101, clientY: 301 });
        expect(fireEvent.click(link, { bubbles: true, cancelable: true }),
            "スワイプの札が残っていて、次のタップが丸ごと飲まれている").toBe(true);
    });
});
