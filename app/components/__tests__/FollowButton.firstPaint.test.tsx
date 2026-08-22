import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, waitFor } from "@testing-library/react";

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

// 配線の検証: FollowAction は数を描かないので、useFollow に「数は要らない」と
// 伝える（第3引数 false）。これが外れると、ユーザー検索の結果 N 件で
// GET /users/<id>/follow が N 本飛ぶ（結果は画面のどこにも描かれない）。
// フック側の性質は lib/hooks/__tests__/useFollow.test.tsx が測っている。
// ここはコンポーネントが実際にそう呼んでいることを、マウントして確かめる。
describe("FollowAction: 数の問い合わせを投げない", () => {
    it("マウントして判定が終わっても、数の取得（userPublicFetch）は呼ばれない", async () => {
        const api = await import("../../../lib/utils/api");
        vi.mocked(api.userPublicFetch).mockClear();
        vi.mocked(api.userFetch).mockClear();

        render(
            <FollowAction
                targetUserId="22222222-2222-4222-8222-222222222222"
                isOwner={false}
                isAuthenticated
                locale="ja"
            />,
        );
        // フォロー中かどうかの一覧は取りに行く（ボタンの表示に必要）
        await waitFor(() => expect(api.userFetch).toHaveBeenCalled());
        // 数はどこにも描かないので取りに行かない
        expect(api.userPublicFetch).not.toHaveBeenCalled();
    });
});
