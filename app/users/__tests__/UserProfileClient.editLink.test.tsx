import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * **プロフィールの一覧から、自分の写真を編集画面へ開けること。**
 *
 * 編集そのものは前からある（`/user/edit?id=` が題・説明・撮影地・地図の位置・
 * カテゴリ・撮影日・タグ・公開/非公開・削除を扱う）。無かったのは**そこへ行く
 * 道**で、一覧に出る本人向けの操作はピン留め・公開/非公開・削除の3つだけ
 * だった——「一覧から消せるようにした」ときに書いた理由（写真を1枚ずつ開いて
 * `/user/edit` まで行く必要があった）が、編集にはそのまま残っていた。
 *
 * **投稿と年表の2つのグリッドがある。** 片方だけに付くのが台帳のいちばん多い
 * 失敗なので、両方を描いて数える。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../data/photos.json", () => ({ default: [] }));

const OWNER = "33333333-3333-4333-8333-333333333333";

import UserProfileClient from "../UserProfileClient";

/** 年表タブが日付で束ねられるよう、**違う月**の2枚にする */
const photo = (id: string, date: string) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id,
    category: "travel", tags: [], date, createdAt: date, published: true,
});
const TWO = [photo("aaa", "2026-01-01"), photo("bbb", "2026-02-01")];

const asOwner = () =>
    mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => TWO });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => TWO });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
    mockShowToast.mockReset();
});

const editLinks = async () => {
    await waitFor(() => expect(screen.getAllByLabelText("この写真を編集").length).toBeGreaterThan(0));
    return screen.getAllByLabelText("この写真を編集");
};

describe("プロフィールの一覧から編集画面へ", () => {
    it("本人には各カードに編集が出て、その写真の編集画面を指す", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        const links = await editLinks();
        expect(links).toHaveLength(TWO.length);
        // **その写真の id を持っていること。** 行き先が固定だと、どのカードを
        // 押しても同じ写真が開く（押した写真と違うものを編集させる形）
        expect(links.map((a) => a.getAttribute("href")))
            .toEqual(["/user/edit?id=aaa", "/user/edit?id=bbb"]);
    });

    it("他人のプロフィールには出ない", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getAllByAltText("aaa").length).toBeGreaterThan(0));
        expect(screen.queryAllByLabelText("この写真を編集")).toHaveLength(0);
    });

    // **入口が2つある。** 投稿グリッドだけに付けると、年表から入った人には
    // 出ない（台帳の「片方だけ直す」）
    it("年表タブのカードにも出る", async () => {
        asOwner();
        const user = (await import("@testing-library/user-event")).default;
        render(<UserProfileClient userId={OWNER} />);
        await editLinks();
        await user.click(screen.getByRole("tab", { name: /年表/ }));
        const links = await editLinks();
        expect(links.length, "年表のカードに編集が無い").toBeGreaterThan(0);
        expect(links.map((a) => a.getAttribute("href"))).toContain("/user/edit?id=aaa");
    });

    // **先読みしないことはここでは見ない。** `next/link` は `prefetch` を
    // 属性として描かないので、`getAttribute("prefetch")` を見る判定は
    // **どちらに転んでも通る**（実際に `prefetch={false}` を外して素通りした）。
    // 見張りは `app/__tests__/linkPrefetch.test.ts` にあり、外すと
    // 「免除に無いファイルの `<Link>` は全部 `prefetch={false}`」が
    // このファイルの該当行を名指しで落とす（確認済み）。
});
