import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// 最初の描画（静的書き出しの HTML と、水和する前の1フレーム）で
// フォローボタンが押せてしまうと、フォロー中かどうかが分かる前に
// 押せる。押しても既にフォロー済みで画面が変わらない。
//
// `resolved` の**初期値**が効くのはここだけで、マウント後は effect が
// 決め直すため、通常の render では初期値を壊しても気づけない
// （実際に変異テストで素通りした）。サーバー描画で固定する。

vi.mock("../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ userIds: [] }) })),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
    publicFetch: vi.fn(),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const { FollowAction } = await import("../FollowButton");

describe("フォローボタンの最初の描画", () => {
    it("判定が終わる前は押せない（disabled で出る）", () => {
        const html = renderToStaticMarkup(
            <FollowAction
                targetUserId="22222222-2222-4222-8222-222222222222"
                isOwner={false}
                isAuthenticated
                locale="ja"
            />,
        );
        // **属性で見る。** className に `disabled:opacity-50` という
        // Tailwind のクラスが入っているので、単に "disabled" を含むかでは
        // 常に真になり、何も測れない（実際に一度そう書いて素通りした）。
        expect(html).toContain("<button");
        expect(/<button[^>]*\sdisabled(=|\s|>)/.test(html)).toBe(true);
    });

    it("自分のプロフィールでは何も出さない（今までどおり）", () => {
        const html = renderToStaticMarkup(
            <FollowAction
                targetUserId="22222222-2222-4222-8222-222222222222"
                isOwner
                isAuthenticated
                locale="ja"
            />,
        );
        expect(html).toBe("");
    });
});
