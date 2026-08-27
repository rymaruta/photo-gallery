import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ピン留めは「配列まるごと」を PUT していた。この画面はプロフィールを
// 開いたときに1回読むだけなので、PC のタブを開いたままスマホでピン留めすると、
// 次に PC でピン留めしたときスマホの分が消える（サーバーは新しい rev を
// 普通に書けるため、rev では検出できない）。増減で送る。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../lib/auth/cognito", () => ({ getCurrentSession: mockGetCurrentSession }));
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
        // 実物を使う（文言の分岐まで測るため）
        readApiError: actual.readApiError,
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import UserProfileClient from "../UserProfileClient";

const ME = "11111111-1111-4111-8111-111111111111";
const session = (sub: string) => ({ getIdToken: () => ({ payload: { sub } }) });
const photo = (id: string) => ({
    id, src: `https://cdn/x/${id}.jpg`, userId: ME, published: true,
    title: id, createdAt: "2026-08-01T00:00:00Z",
});

/** PUT /user/profile の body */
function putBodies(): Record<string, unknown>[] {
    return mockUserFetch.mock.calls
        .filter((c) => c[1]?.method === "PUT")
        .map((c) => JSON.parse(c[1].body as string) as Record<string, unknown>);
}

/** オーナーとして開き、写真2枚が出るまで待つ */
async function openAsOwner(profile: Record<string, unknown>) {
    mockGetCurrentSession.mockResolvedValue(session(ME));
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => profile });
    mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === "PUT") {
            return Promise.resolve({ ok: true, json: async () => ({ ...profile, pinnedPhotoIds: ["p9", "p1"] }) });
        }
        return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
    });
    render(<UserProfileClient userId={ME} />);
    await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
}

beforeEach(() => {
    mockUserFetch.mockReset();
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset();
    mockGetCurrentSession.mockReset();
    mockShowToast.mockReset();
});

describe("ピン留めの送り方", () => {
    it("配列ではなく「どの1枚をどうするか」を送る", async () => {
        // 手元のプロフィールは p9 を知らない（開いた時点では空だった）
        await openAsOwner({ userId: ME, displayName: "旅人" });
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(putBodies()).toHaveLength(1));
        const body = putBodies()[0];
        expect(body).toEqual({ pinPhotoId: "p1", pin: true });
        // 配列を送っていない（送ると、知らない p9 を消してしまう）
        expect(body).not.toHaveProperty("pinnedPhotoIds");
    });

    it("解除も1枚単位で送る", async () => {
        await openAsOwner({ userId: ME, displayName: "旅人", pinnedPhotoIds: ["p1"] });
        fireEvent.click(screen.getAllByTitle("ピン留め解除")[0]);

        await waitFor(() => expect(putBodies()).toHaveLength(1));
        expect(putBodies()[0]).toEqual({ pinPhotoId: "p1", pin: false });
    });

    it("保存後はサーバーが返した一覧に揃える（他の端末の分を取り込む）", async () => {
        // 手元は「1枚もピン留めしていない」と思っている。
        // 実際は別の端末が p2 をピン留め済みで、サーバーは2枚を返す。
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p2", "p1"] }) });
            }
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        expect(screen.queryAllByTitle("ピン留め解除")).toHaveLength(0);

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        // 見込みでは1枚だが、サーバーの返り値を取り込んで2枚になる。
        // 取り込まないと、次にもう1枚押したとき手元は「まだ1枚」のつもりで
        // 上限（3枚）の案内も出せず、サーバーの実態とずれ続ける。
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(2));
    });

    it("サーバーが断った理由をそのまま出す（「保存に失敗しました」で潰さない）", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: "ピン留めは3枚までです" }) });
            }
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("ピン留めは3枚までです", "error"));
        // 見込みで付けた星は戻す
        await waitFor(() => expect(screen.queryAllByTitle("ピン留め解除")).toHaveLength(0));
    });
});
