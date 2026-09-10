import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **同じページの中で「投稿 N」が2通りある。**
//
// 本人の一覧は `/user/photos`（下書き・非公開を含む）、訪問者は
// `/photos?userId=`（公開ぶんだけ）。OGP の `photoCount` も公開ぶんなので、
// 本人が見る N だけがどことも一致しない。数を揃えると今度は「下書きが
// 数に入らない＝増えていない」に見えるので、**本人にだけ内訳を添える**。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
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

const photo = (id: string, published: boolean) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id,
    category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01", published,
});

/** 本人の一覧: 公開2枚 + 非公開1枚 */
const MINE = [photo("a", true), photo("b", true), photo("c", false)];

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => MINE });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => MINE.filter(p => p.published) });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

describe("プロフィールの「投稿 N」", () => {
    it("本人には内訳（うち非公開 N）を添える", async () => {
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });
        render(<UserProfileClient userId={OWNER} />);

        await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
        expect(screen.getByText("（うち非公開 1）"),
            "本人の N（下書き込み）が、訪問者や OGP の N と食い違ったまま説明が無い").toBeInTheDocument();
    });

    it("訪問者には出さない（そもそも公開ぶんしか数えない）", async () => {
        render(<UserProfileClient userId={OWNER} />);

        await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
        expect(screen.queryByText(/うち非公開/), "他人の非公開の枚数が漏れている").toBeNull();
    });

    it("非公開が1枚も無ければ、本人にも出さない", async () => {
        const allPublic = [photo("a", true), photo("b", true)];
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => allPublic });
        mockGetCurrentSession.mockResolvedValue({ getIdToken: () => ({ payload: { sub: OWNER } }) });
        render(<UserProfileClient userId={OWNER} />);

        await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
        expect(screen.queryByText(/うち非公開/)).toBeNull();
    });
});
