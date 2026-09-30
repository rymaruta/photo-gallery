// @vitest-environment jsdom
// ↑ happy-dom では写真の <img> が alt で見つからない（描かれ方が違う。原因は未調査）。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **プロフィールの一覧から写真を消せること。**
 *
 * サーバーの `DELETE /photos/{id}`（`deleteMyPhoto`）も共有の確認シート
 * （`DeleteConfirmModal`）も前からあったが、**プロフィールの一覧には削除が
 * 無かった**——本人に出る操作は「公開する/非公開にする」と「カバーに設定」
 * だけで、消すには写真を1枚ずつ開いて `/user/edit` まで行く必要があった。
 *
 * **取り消せない操作なので、いちばん大事なのは「押しただけでは消えない」こと。**
 * 確認シートを挟み、そこで確定するまで要求を投げない。
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

const photo = (id: string) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id,
    category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01", published: true,
});
const TWO = [photo("aaa"), photo("bbb")];

/** DELETE だけ別の答えを返せるようにする */
function routeFetch(onDelete: () => unknown) {
    mockUserFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
        if (init?.method === "DELETE") return onDelete();
        return { ok: true, json: async () => TWO };
    });
}

const asOwner = () =>
    mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });

beforeEach(() => {
    mockUserFetch.mockReset();
    routeFetch(() => ({ ok: true, json: async () => ({}) }));
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => TWO });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
    mockShowToast.mockReset();
});

const deleteButtons = async () => {
    await waitFor(() => expect(screen.getAllByLabelText("この写真を削除").length).toBeGreaterThan(0));
    return screen.getAllByLabelText("この写真を削除");
};

describe("プロフィールの一覧から写真を消す", () => {
    it("本人には各カードに削除が出る", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        expect(await deleteButtons()).toHaveLength(TWO.length);
    });

    it("他人には出ない", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getAllByAltText("aaa").length).toBeGreaterThan(0));
        expect(screen.queryAllByLabelText("この写真を削除")).toHaveLength(0);
    });

    // **ここがいちばん大事。** 取り消せない操作なので、押しただけでは消えない
    it("押しただけでは消えない（確認シートが出るだけで、要求は飛ばない）", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        await userEvent.click((await deleteButtons())[0]);

        expect(await screen.findByRole("dialog", { name: "この写真を削除しますか？" })).toBeInTheDocument();
        expect(mockUserFetch.mock.calls.filter(([, i]) => i?.method === "DELETE"),
            "確認する前に消しにいっている").toHaveLength(0);
    });

    it("確認して初めて消える（一覧からも外れる）", async () => {
        asOwner();
        render(<UserProfileClient userId={OWNER} />);
        await userEvent.click((await deleteButtons())[0]);
        await userEvent.click(screen.getByRole("button", { name: "削除する" }));

        await waitFor(() => expect(
            mockUserFetch.mock.calls.filter(([, i]) => i?.method === "DELETE"),
        ).toHaveLength(1));
        const [path] = mockUserFetch.mock.calls.find(([, i]) => i?.method === "DELETE")!;
        expect(path).toBe("/photos/aaa");
        await waitFor(() => expect(screen.queryAllByAltText("aaa")).toHaveLength(0));
        expect(screen.getAllByAltText("bbb").length, "関係ない写真まで消えている").toBeGreaterThan(0);
    });

    it("失敗したらサーバーの理由を出し、一覧からは消さない", async () => {
        asOwner();
        // **サーバーは `{ error }` で返す**（`api-user/src/http.ts` の `jsonError`）。
        // `message` は API Gateway 由来の英語定型なので `readApiError` は弾く
        routeFetch(() => ({ ok: false, status: 500, json: async () => ({ error: "画像の削除を完了できませんでした。時間をおいてもう一度お試しください" }) }));
        render(<UserProfileClient userId={OWNER} />);
        await userEvent.click((await deleteButtons())[0]);
        await userEvent.click(screen.getByRole("button", { name: "削除する" }));

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockShowToast.mock.calls.at(-1)?.[0]).toContain("画像の削除を完了できませんでした");
        expect(mockShowToast.mock.calls.at(-1)?.[1]).toBe("error");
        expect(screen.getAllByAltText("aaa").length, "消えていないのに一覧から外している").toBeGreaterThan(0);
    });
});
