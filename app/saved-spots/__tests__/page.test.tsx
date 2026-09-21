import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 行きたい場所の一覧。
 *
 * ここで固定したいのは3つ:
 *
 *  1. **「まだ」「聞けなかった」「0件」を混ぜない**——通信に失敗しただけの
 *     人に「保存した場所はまだありません」と言い切らない
 *  2. **見出しは集約ページの関数から引く**（サーバーはスラッグしか返さない）。
 *     ここで別に作ると、飛んだ先の見出しと食い違う
 *  3. **保存した順（新しい順）を保つ**——枚数順に並べ替えない
 */
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const photosState = vi.hoisted(() => ({ photos: [] as Photo[], loaded: true, failed: false }));
vi.mock("../../../lib/hooks/usePhotos", () => ({ usePhotos: () => photosState }));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({ userFetch: fetchMock }));

import SavedSpotsPage from "../page";

const P = (id: string, location: string): Photo =>
    ({ id, src: `https://cdn/${id}.jpg`, location }) as Photo;

const ok = (slugs: string[]) => ({ ok: true, json: async () => ({ slugs }) });

beforeEach(() => {
    fetchMock.mockReset();
    auth.isAuthenticated = true;
    auth.loading = false;
    photosState.photos = [
        P("1", "パリ"), P("2", "パリ"), P("3", "パリ, フランス"),
        P("4", "山中湖"), P("5", "山中湖"),
    ];
    photosState.loaded = true;
});

describe("行きたい場所の一覧", () => {
    it("保存した順（新しい順）のまま並べる", async () => {
        fetchMock.mockResolvedValue(ok(["山中湖", "パリ"]));
        render(<SavedSpotsPage />);
        const items = await screen.findAllByRole("listitem");
        expect(items.map((li) => within(li).getAllByRole("link")[0].textContent)).toEqual(
            ["山中湖2枚", "パリ3枚"],
        );
    });

    // **見出しは `collectEntries` から引く。** ここで別に作ると
    // チップと飛び先の字が食い違う（`pickRepresentative` が名指しで避けている形）
    it("見出しと枚数は集約ページの関数から引く", async () => {
        fetchMock.mockResolvedValue(ok(["パリ"]));
        render(<SavedSpotsPage />);
        // `/location/パリ` には「パリ, フランス」の写真も載る（向きのある一致）
        expect(await screen.findByText("3枚")).toBeTruthy();
    });

    // **「まだ」と「0件」を混ぜない**
    it("読み込み中は「まだありません」と言い切らない", () => {
        fetchMock.mockReturnValue(new Promise(() => { /* 返らない */ }));
        render(<SavedSpotsPage />);
        expect(screen.getByText("読み込み中…")).toBeTruthy();
        expect(screen.queryByText("行きたい場所はまだありません。")).toBeNull();
    });

    it("本当に0件のときだけ「まだありません」と言う", async () => {
        fetchMock.mockResolvedValue(ok([]));
        render(<SavedSpotsPage />);
        expect(await screen.findByText("行きたい場所はまだありません。")).toBeTruthy();
    });

    // **失敗と0件を混ぜない。** 混ぜると、通信に失敗しただけの人に
    // 「無い」と言い切ることになる
    it("取得に失敗したら、その旨を出して再試行を置く", async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
        render(<SavedSpotsPage />);
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("読み込めませんでした");
        expect(within(alert).getByRole("button", { name: "再試行" })).toBeTruthy();
    });

    /**
     * **失敗した回に「0件」と言い切らない。**
     *
     * 一度 `slugs.length` をそのまま出していたので、見出しが
     * 「保存した場所 0 件」・本文が「行きたい場所はまだありません。」に
     * なっていた——このファイルの docstring が「混ぜない」と書いている当の形。
     */
    it("失敗した回は、件数も「まだありません」も出さない", async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
        render(<SavedSpotsPage />);
        await screen.findByRole("alert");
        expect(screen.queryByText("行きたい場所はまだありません。")).toBeNull();
        expect(screen.queryByText(/保存した場所 0 件/)).toBeNull();
    });

    it("未ログインなら、聞きに行かずログインへ誘う", () => {
        auth.isAuthenticated = false;
        render(<SavedSpotsPage />);
        expect(screen.getByRole("link", { name: "ログイン" })).toBeTruthy();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    /**
     * **見出しが引けないときに、こちらで言葉を作らない。**
     *
     * 引けないのは、その撮影地の写真が非公開になった／一覧がまだ
     * 届いていないとき。「不明な場所」のような語を置くと、無い情報を
     * 作ることになる——スラッグをそのまま出す。
     */
    it("見出しを引けないスラッグは、スラッグのまま出す", async () => {
        fetchMock.mockResolvedValue(ok(["消えた場所"]));
        render(<SavedSpotsPage />);
        expect(await screen.findByText("消えた場所")).toBeTruthy();
        expect(screen.queryByText(/不明|見つかりません/)).toBeNull();
    });

    it("外すと、サーバーが返した一覧をそのまま映す", async () => {
        fetchMock.mockResolvedValueOnce(ok(["山中湖", "パリ"]));
        render(<SavedSpotsPage />);
        const remove = await screen.findByRole("button", { name: "「山中湖」を外す" });
        fetchMock.mockResolvedValueOnce(ok(["パリ"]));
        remove.click();
        await waitFor(() => expect(screen.queryByText("山中湖")).toBeNull());
        expect(fetchMock).toHaveBeenLastCalledWith(
            `/user/spots/${encodeURIComponent("山中湖")}`,
            { method: "DELETE" },
        );
    });
});
