import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ROUTES } from "@/lib/routes";

// **直したものを、戻るボタン1つで黙って捨てていた。**
// この画面には未保存を知らせる仕組みが1つも無く（`beforeunload` も
// 確認も 0件）、スマホで長い説明を打ち直したあと左上の矢印を押すと
// 何も聞かれずに前の画面へ戻る。「保存する」は画面のいちばん下にあり、
// 矢印は上にあるので、押し間違いは指の位置の問題ですらある。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: mockUserFetch };
});
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const photo = {
    id: "p1", src: "https://cdn/p1.jpg",
    title: { ja: "夕焼け", en: "Sunset" },
    description: { ja: ["海の色が変わる時間"], en: [] },
    location: "江ノ島", category: "landscape", date: "2024-11-01",
    tags: ["旅", "海"], published: true,
};

beforeEach(() => {
    mockPush.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [photo] });
});

/** 読み込みが終わって、欄に保存済みの値が入るまで待つ */
async function loaded() {
    render(<EditPage />);
    const title = await screen.findByDisplayValue("夕焼け");
    await waitFor(() => expect(screen.getByDisplayValue("江ノ島")).toBeInTheDocument());
    return title as HTMLInputElement;
}

const backLink = () => screen.getByRole("link", { name: "戻る" });

describe("/user/edit: 未保存のまま戻る", () => {
    it("何も直していなければ、そのまま戻る（確認を出さない）", async () => {
        await loaded();
        // **偽陽性を出さない方が難しい。** 開いた値を組み直して比べるので、
        // 日付やタイトルの入れ物の形が少しでもずれると「変えていないのに
        // 毎回聞く」になり、利用者は読まずに押すようになる
        expect(fireEvent.click(backLink()), "何も直していないのに止めている").toBe(true);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("直したまま戻ろうとしたら、確認してから捨てる", async () => {
        const title = await loaded();
        fireEvent.change(title, { target: { value: "夕焼けの色" } });

        expect(fireEvent.click(backLink()), "直したのに黙って戻している").toBe(false);
        const dialog = await screen.findByRole("dialog", { name: /保存していない/ });
        expect(dialog).toBeInTheDocument();
        expect(mockPush, "確認の前に移動している").not.toHaveBeenCalled();
    });

    it("「破棄して戻る」で、行き先へ移る", async () => {
        const title = await loaded();
        fireEvent.change(title, { target: { value: "夕焼けの色" } });
        fireEvent.click(backLink());
        fireEvent.click(await screen.findByRole("button", { name: "破棄して戻る" }));
        // 公開中の写真なので写真ページへ（下書きなら下書き一覧）。
        // ビルド時 JSON に無い id は `/?photo=` になるので、行き先は
        // 決め打ちにせず `ROUTES` に聞く（ここを固定すると、写真が
        // 静的ページを持つかどうかでテストだけが落ちる）
        expect(mockPush).toHaveBeenCalledWith(ROUTES.PHOTO("p1"));
    });

    it("「編集を続ける」で閉じ、打ったものは残る", async () => {
        const title = await loaded();
        fireEvent.change(title, { target: { value: "夕焼けの色" } });
        fireEvent.click(backLink());
        fireEvent.click(await screen.findByRole("button", { name: "編集を続ける" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByDisplayValue("夕焼けの色"), "打ったものが消えている").toBeInTheDocument();
        expect(mockPush, "続けると言ったのに移動している").not.toHaveBeenCalled();
    });

    it("説明・撮影地・タグ・撮影日を直した場合も止める", async () => {
        await loaded();
        for (const [current, next] of [
            ["海の色が変わる時間", "海の色が変わる"],
            ["江ノ島", "鎌倉"],
            ["旅, 海", "旅"],
            ["landscape", "portrait"],
            ["2024-11-01", "2024-11-02"],
        ] as const) {
            const el = screen.getByDisplayValue(current);
            fireEvent.change(el, { target: { value: next } });
            expect(fireEvent.click(backLink()), `${current} を直したのに止めていない`).toBe(false);
            fireEvent.click(screen.getByRole("button", { name: "編集を続ける" }));
            await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
            fireEvent.change(screen.getByDisplayValue(next), { target: { value: current } });   // 戻す
        }
    });
    // **座標は「触ったか」で見る。** 同じ候補を選び直しただけでも、保存すると
    // サーバーが「おおよそ」の印を落とす（＝結果が変わる）。値の差分だけで
    // 判定すると、その操作を黙って捨てることになる
    it("地図に出す位置を触ったら、値が同じでも止める", async () => {
        const coords = { lat: 35.3, lng: 139.4 };
        mockUserFetch.mockReset().mockImplementation((url: string) => {
            if (String(url).startsWith("/geocode/search")) {
                // **機械が当てたのと同じ場所**を候補に出す（値は変わらない）
                return Promise.resolve({ ok: true, json: async () => ({ results: [{ label: "江ノ島, 藤沢市", ...coords }] }) });
            }
            return Promise.resolve({ ok: true, json: async () => [{ ...photo, coords }] });
        });
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");

        fireEvent.click(screen.getByRole("button", { name: "この場所名で候補を出す" }));
        fireEvent.click(await screen.findByRole("button", { name: "江ノ島, 藤沢市" }));

        // 値は1つも変わっていない。それでも保存すればサーバーの扱いは変わる
        expect(fireEvent.click(backLink()), "位置を選び直したのに止めていない").toBe(false);
    });

    it("地図から外したときも止める", async () => {
        mockUserFetch.mockReset().mockResolvedValue({
            ok: true, json: async () => [{ ...photo, coords: { lat: 35.3, lng: 139.4 } }],
        });
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");
        fireEvent.click(await screen.findByRole("button", { name: "地図に出さない" }));
        expect(fireEvent.click(backLink()), "位置を外したのに止めていない").toBe(false);
    });

    it("最初のフォーカスは「編集を続ける」（捨てる方に指を置かない）", async () => {
        const title = await loaded();
        fireEvent.change(title, { target: { value: "夕焼けの色" } });
        fireEvent.click(backLink());
        await screen.findByRole("dialog");
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole("button", { name: "編集を続ける" }));
        });
    });

    it("Escape でも閉じる（打ったものは残る）", async () => {
        const title = await loaded();
        fireEvent.change(title, { target: { value: "夕焼けの色" } });
        fireEvent.click(backLink());
        await screen.findByRole("dialog");
        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByDisplayValue("夕焼けの色")).toBeInTheDocument();
    });
    // **移行が要る行を、毎回「変わった」と言わない。** 保存の側は
    // 捏造の UTC 0時（C-12）をわざと日付だけへ倒すので、その行は開いた
    // 瞬間から差分ありになる。触っていないのに毎回聞かれると、利用者は
    // 読まずに押すようになる
    it("捏造の UTC 0時で保存されている写真でも、触らなければ止めない", async () => {
        mockUserFetch.mockReset().mockResolvedValue({
            ok: true, json: async () => [{ ...photo, date: "2024-11-01T00:00:00.000Z" }],
        });
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");
        await waitFor(() => expect(screen.getByDisplayValue("2024-11-01")).toBeInTheDocument());
        expect(fireEvent.click(backLink()), "触っていないのに止めている").toBe(true);
    });

    it("その写真でも、日付を直したら止める", async () => {
        mockUserFetch.mockReset().mockResolvedValue({
            ok: true, json: async () => [{ ...photo, date: "2024-11-01T00:00:00.000Z" }],
        });
        render(<EditPage />);
        const el = await screen.findByDisplayValue("2024-11-01");
        fireEvent.change(el, { target: { value: "2024-11-02" } });
        expect(fireEvent.click(backLink()), "日付を直したのに止めていない").toBe(false);
    });

    it("オーバーレイを押しても閉じる（打ったものは残る）", async () => {
        const title = await loaded();
        fireEvent.change(title, { target: { value: "夕焼けの色" } });
        fireEvent.click(backLink());
        fireEvent.click(await screen.findByRole("dialog"));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByDisplayValue("夕焼けの色")).toBeInTheDocument();
        expect(mockPush, "閉じただけなのに移動している").not.toHaveBeenCalled();
    });

    it("破棄して戻ったら、確認は閉じる", async () => {
        const title = await loaded();
        fireEvent.change(title, { target: { value: "夕焼けの色" } });
        fireEvent.click(backLink());
        fireEvent.click(await screen.findByRole("button", { name: "破棄して戻る" }));
        // 遷移で消えるとは限らない（同じ画面に留まる経路もある）。
        // 開きっぱなしだと、行き先の上に確認シートが残って見える
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
});
