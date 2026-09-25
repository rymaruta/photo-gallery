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

/**
 * **公式スポットの台帳は差し替える。**
 *
 * `content/spots.json` はいま空（人が書く棚で、まだ1件も入っていない）。
 * 実データに寄りかかると、台帳に1件入った日に**この判定が別のことを見る**。
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));

/** 公開条件を全部満たす1件（`spotGuide.publishBlockers` を通す） */
const SPOT = (slug: string, name: string) => ({
    spotId: `sp_${slug}`,
    slug,
    name,
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
    coords: { lat: 34.1, lng: 133.6 },
    highlights: ["雲海が出る朝がある"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
});

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
    ledger.spots = [];
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

    /**
     * **1件でも書き込み中なら、全部押させない。**
     *
     * `busy === slug` だけを見ていたので、行Aの処理中に行Bの「外す」を
     * 押すと `toggle` が `false` を返して**何も起きない**（押せるのに無反応）。
     */
    it("1件の書き込み中は、他の行の「外す」も押せない", async () => {
        fetchMock.mockResolvedValueOnce(ok(["山中湖", "パリ"]));
        render(<SavedSpotsPage />);
        const a = await screen.findByRole("button", { name: "「山中湖」を外す" });
        const b = screen.getByRole("button", { name: "「パリ」を外す" });
        // 返らない応答で書き込み中のまま止める
        fetchMock.mockReturnValueOnce(new Promise(() => { /* 返らない */ }));
        a.click();
        await waitFor(() => expect(a).toBeDisabled());
        expect(b, "他の行が押せるのに無反応になる").toBeDisabled();
    });

    /**
     * **公式撮影地ガイドと、撮影地の集約ページが同じ一覧に並ぶ。**
     *
     * 鍵は `SPOT-<slug>`。**API は1行も変えていない**——サーバーは
     * 「`#` を含まない文字列」を受けるだけで、種別を知らない。
     */
    describe("公式撮影地ガイド", () => {
        it("台帳の名前で出し、`/spots/<slug>` へ送る", async () => {
            ledger.spots = [SPOT("takaya-jinja", "高屋神社")];
            fetchMock.mockResolvedValue(ok(["SPOT-takaya-jinja"]));
            render(<SavedSpotsPage />);
            const link = await screen.findByRole("link", { name: /高屋神社/ });
            expect(link.getAttribute("href")).toBe("/spots/takaya-jinja");
            // 見分けが付く（撮影地の集約ページと同じ見た目にしない）
            expect(within(link).getByText("公式")).toBeTruthy();
        });

        /// 「公式」と名乗るのは人が確かめた行だけ。運営未確認の下書きは**ページを建てない**
        /// （`BUILD_DRAFT_SPOTS = false`・2026-09-25）ので、保存してあってもリンクにしない
        /// ——押すと 404 へ送ることになる。行と「外す」は残す（台帳から下りた行と同じ扱い）
        it("下書きのスポットはリンクにせず、「公式」とも名乗らない", async () => {
            ledger.spots = [{ ...SPOT("takaya-jinja", "高屋神社"), status: "review", verifiedBy: undefined, verifiedAt: undefined, draftedAt: "2026-09-24" }];
            fetchMock.mockResolvedValue(ok(["SPOT-takaya-jinja"]));
            render(<SavedSpotsPage />);
            await screen.findByRole("button", { name: /を外す/ });
            expect(screen.queryByRole("link", { name: /高屋神社|takaya-jinja/ })).toBeNull();
            expect(screen.queryByText("公式")).toBeNull();
        });

        /// 🔴 **同じ綴りでも別物として残す。** owner:「対応関係が不明な項目を
        /// 勝手に同一スポットとして統合しないでください」
        it("同じ綴りの撮影地と公式スポットは、2行として残る", async () => {
            ledger.spots = [SPOT("山中湖", "山中湖（公式）")];
            fetchMock.mockResolvedValue(ok(["SPOT-山中湖", "山中湖"]));
            render(<SavedSpotsPage />);
            const items = await screen.findAllByRole("listitem");
            expect(items).toHaveLength(2);
            expect(items[0].textContent).toContain("山中湖（公式）");
            expect(items[1].textContent).toContain("2枚");
        });

        /**
         * **台帳から下りたスポットは、行ごと消さない。**
         *
         * 消すと本人が外す手段を失う（サーバーには残ったまま）。
         * リンクだけ外す——押しても 404 のページへ送らない。
         */
        it("台帳に無いスポットは、リンクを外して残す", async () => {
            fetchMock.mockResolvedValue(ok(["SPOT-kieta"]));
            render(<SavedSpotsPage />);
            const item = (await screen.findAllByRole("listitem"))[0];
            expect(within(item).queryByRole("link")).toBeNull();
            expect(item.textContent).toContain("kieta");
            expect(within(item).getByRole("button", { name: "「kieta」を外す" })).toBeTruthy();
        });

        /**
         * 🔴 **地域名は名前と同じ行に置かない。**
         *
         * 同じ枠（`shrink-0`）に入れると、**縮む側が名前だけ**になる。
         * 320px で本物の CSS を当てて実測（2026-09-23）:
         *
         *     同じ行   「高屋神社（天空の鳥居）」 名前の枠 85px → 切れる
         *     次の行   同                        名前の枠 135px → 切れない
         *
         * 行の高さは変わらない（2行でも `minHeight: 44` に収まる）。
         * 撮影地の「3枚」は短く長さも決まっているので同じ行のまま。
         */
        it("地域名は次の行（縮むのが名前だけにならない）", async () => {
            ledger.spots = [SPOT("takaya-jinja", "高屋神社（天空の鳥居）")];
            fetchMock.mockResolvedValue(ok(["SPOT-takaya-jinja"]));
            render(<SavedSpotsPage />);
            const item = (await screen.findAllByRole("listitem"))[0];
            const region = within(item).getByText("香川県 観音寺市");
            const name = within(item).getByText("高屋神社（天空の鳥居）");
            // 地域は自由長なので**縮める**。名前と同じ行の固定枠に入れない
            expect(region.className, "地域が縮まないと、名前だけが縮む").toContain("truncate");
            expect(region.className).not.toContain("shrink-0");
            // 名前と地域は別の行（同じ親の中で並んでいない）
            expect(name.parentElement).not.toBe(region.parentElement);
        });

        it("撮影地の枚数は名前と同じ行のまま（短く長さが決まっている）", async () => {
            fetchMock.mockResolvedValue(ok(["パリ"]));
            render(<SavedSpotsPage />);
            const item = (await screen.findAllByRole("listitem"))[0];
            const count = within(item).getByText("3枚");
            const name = within(item).getByText("パリ");
            expect(count.className).toContain("shrink-0");
            expect(name.parentElement).toBe(count.parentElement);
        });

        it("外すときも、保存したときと同じ鍵を送る", async () => {
            ledger.spots = [SPOT("takaya-jinja", "高屋神社")];
            fetchMock.mockResolvedValueOnce(ok(["SPOT-takaya-jinja"]));
            render(<SavedSpotsPage />);
            const remove = await screen.findByRole("button", { name: "「高屋神社」を外す" });
            fetchMock.mockResolvedValueOnce(ok([]));
            remove.click();
            await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
                "/user/spots/SPOT-takaya-jinja", { method: "DELETE" },
            ));
        });

        /**
         * 🔴 **スラッグの無い壊れた鍵も、行として残す。**
         *
         * 一度は落としていたが、**落とすと画面に出ないのにサーバーには残り、
         * 本人が外す手段を失う**（レビューが指摘）。入る隙は
         * `publishBlockers` が塞いだが、既に入ったものは外せるようにする。
         * 名前が作れないので**鍵そのもの**を出す（こちらで言葉を作らない）。
         */
        it("スラッグの無い鍵も残し、外せるようにする", async () => {
            fetchMock.mockResolvedValue(ok(["SPOT-", "パリ"]));
            render(<SavedSpotsPage />);
            const items = await screen.findAllByRole("listitem");
            expect(items).toHaveLength(2);
            expect(items[0].textContent).toContain("SPOT-");
            expect(within(items[0]).getByRole("button", { name: "「SPOT-」を外す" })).toBeTruthy();
            expect(screen.getByText("保存した場所 2 件")).toBeTruthy();
        });

        /// 件数は**描く一覧そのもの**で数える（畳んだぶんと行数が食い違わない）
        it("同じ鍵が2つ来ても、件数と行数は一致する", async () => {
            fetchMock.mockResolvedValue(ok(["パリ", "パリ", "山中湖"]));
            render(<SavedSpotsPage />);
            expect(await screen.findByText("保存した場所 2 件")).toBeTruthy();
            expect(screen.getAllByRole("listitem")).toHaveLength(2);
        });
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
