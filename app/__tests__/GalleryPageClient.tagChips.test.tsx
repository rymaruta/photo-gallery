import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { tagKey } from "../../lib/utils/collections";

// **同じタグのチップが2つ並んでいた。**
//
// 集約ページ（`/tag/<スラッグ>`）が404のときは `?tags=<スラッグ>` に
// 振り替わる。選択は `mount-fuji`、写真が持つタグは `Mount Fuji` なので、
// 完全一致で突き合わせていた頃は「生のタグ（未選択・件数つき）」と
// 「スラッグ（選択済み・件数0）」が両方出ていた。

const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// タグのチップだけを見たいので、FilterBar は本物を使う（モックしない）
const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "travel", tags: ["Mount Fuji"], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "travel", tags: ["night"], date: "2026-01-02", createdAt: "2026-01-02" },
    // 表記ゆれ: 同じタグを違う書き方で持つ写真（`fuji` が2枚、`Fuji` が1枚）。
    // **少ない方（`Fuji`）を先に置く**——「最初に見つけた表記」を代表に
    // する実装でも通ってしまうため（実際その変異で緑になった）
    { id: "p3", src: "https://cdn/c.jpg", title: "う", category: "travel", tags: ["Fuji"], date: "2026-01-03", createdAt: "2026-01-03" },
    { id: "p4", src: "https://cdn/d.jpg", title: "え", category: "travel", tags: ["fuji"], date: "2026-01-04", createdAt: "2026-01-04" },
    { id: "p5", src: "https://cdn/e.jpg", title: "お", category: "food", tags: ["fuji"], date: "2026-01-05", createdAt: "2026-01-05" },
    // 1枚が同じタグを2つの表記で持つ（入力欄は重複を落とさず、保存側の
    // 重複排除も完全一致でしか効かないので、普通に保存される）
    { id: "p6", src: "https://cdn/f.jpg", title: "か", category: "travel", tags: ["旅", "#旅"], date: "2026-01-06", createdAt: "2026-01-06" },
    // 各1枚ずつの表記ゆれ（同数の決着を見るため）。
    // **文字列の大きい方（`paris`）を先に置く**——「先に見つけた方」を
    // 代表にする実装でも通ってしまうため（実際その変異で緑になった）
    { id: "p7", src: "https://cdn/g.jpg", title: "き", category: "travel", tags: ["paris"], date: "2026-01-07", createdAt: "2026-01-07" },
    { id: "p8", src: "https://cdn/h.jpg", title: "く", category: "travel", tags: ["Paris"], date: "2026-01-08", createdAt: "2026-01-08" },
    // **全体では多いが、travel では少ないタグ**（並びの根拠を確かめるため）。
    // 全体: zebra 4 > fuji 3 ／ travel だけ: fuji 2 > zebra 1 で前後が逆になる
    { id: "p9", src: "https://cdn/i.jpg", title: "け", category: "food", tags: ["zebra"], date: "2026-01-09", createdAt: "2026-01-09" },
    { id: "p10", src: "https://cdn/j.jpg", title: "こ", category: "food", tags: ["zebra"], date: "2026-01-10", createdAt: "2026-01-10" },
    { id: "p11", src: "https://cdn/k.jpg", title: "さ", category: "food", tags: ["zebra"], date: "2026-01-11", createdAt: "2026-01-11" },
    { id: "p12", src: "https://cdn/l.jpg", title: "し", category: "travel", tags: ["zebra"], date: "2026-01-12", createdAt: "2026-01-12" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    window.history.replaceState({}, "", "/");
});

describe("タグのチップ", () => {
    it("スラッグで来ても、同じタグのチップは1つ", async () => {
        window.history.replaceState({}, "", "/?tags=mount-fuji");
        render(<GalleryPageClient />);

        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        const labels = screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label") ?? "");
        // **数え方も実装と同じ物差しで。** 「"fuji" を含む」で数えると
        // 別タグの `fuji` まで巻き込み、前方一致だと字面の偶然に頼る。
        // チップのラベルから件数バッジを外して `tagKey` で比べる
        const same = labels.filter((l) => tagKey(l.replace(/ \(\d+\)$/, "")) === "mount-fuji");
        expect(same, `同じタグのチップが2つ出ている: ${JSON.stringify(labels)}`).toHaveLength(1);
    });

    it("そのチップは選択済みとして出る（押せば外せる）", async () => {
        window.history.replaceState({}, "", "/?tags=mount-fuji");
        render(<GalleryPageClient />);

        const chip = await screen.findByRole("switch", { name: /Mount Fuji/ });
        expect(chip, "選択が反映されていない").toHaveAttribute("aria-checked", "true");
    });

    it("選択が無ければ今までどおり全部未選択", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        for (const chip of screen.getAllByRole("switch")) {
            expect(chip).toHaveAttribute("aria-checked", "false");
        }
    });
});

// **表記ゆれが、件数の割れた2つのチップになっていた。**
//
// 絞り込みは `tagKey` で正規化して当てるので、`Fuji` と `fuji` の
// どちらを押しても出る写真は同じ。なのに数字だけが割れて、同じものが
// 2つ並んで見える（`dca777a` で選択判定を正規化したので、いまは
// **両方が同時に光る**）。
describe("表記ゆれのタグ", () => {
    const chips = () => screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label") ?? "");

    it("同じタグは1つのチップに畳む", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

        const fuji = chips().filter((l) => l.toLowerCase().startsWith("fuji"));
        expect(fuji, `表記ゆれで2つ出ている: ${JSON.stringify(chips())}`).toHaveLength(1);
    });

    it("件数は合算し、代表はいちばん多い表記", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

        // fuji が2枚・Fuji が1枚 → 代表は "fuji"、件数は 3
        expect(chips()).toContain("fuji (3)");
    });

    it("別のタグまで畳まない（正常系）", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        expect(chips().some((l) => l.startsWith("night")), "無関係のタグが消えている").toBe(true);
        expect(chips().some((l) => l.startsWith("Mount Fuji")), "別のタグまで畳んでいる").toBe(true);
    });
});

// **バッジの数字が嘘をついていた（`e731478` の回帰）。**
//
// 1枚の写真が `["旅", "#旅"]` のように同じタグを2つの表記で持つと、
// 畳んで足し込む実装では**1枚を2枚と数える**。チップは「2」なのに、
// 押すと「結果: 1 件」。集約ページの数え上げ（`collectEntries`）は
// 最初から写真ごとに1回だけ数えている。
describe("同じ写真が同じタグを2つの表記で持つとき", () => {
    const chips = () => screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label") ?? "");

    it("1枚として数える（バッジと結果が食い違わない）", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

        const tabi = chips().filter((l) => l.startsWith("旅") || l.startsWith("#旅"));
        expect(tabi, `旅のチップ: ${JSON.stringify(tabi)}`).toHaveLength(1);
        // 件数バッジは2件以上のときだけ出る（1件なら数字なし）
        expect(tabi[0], "1枚を2枚と数えている").not.toMatch(/\(\d+\)/);
    });

    // 同数のときの代表が、写真の並び順で入れ替わらないこと。
    // 「先に見つけた方」だと、写真が1枚増えるだけで字面が変わる
    it("同数なら文字列の小さい方を代表にする", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

        const paris = chips().filter((l) => l.toLowerCase().startsWith("paris"));
        expect(paris, "同数の代表が定まっていない").toEqual(["Paris (2)"]);
    });
});

// **バッジが「押したらこうなる」を出していなかった。**
//
// 全写真で数えていたので、カテゴリや検索語で絞っている
// 最中でも全体の枚数が出ていた——チップが「fuji 3」なのに押すと
// 「結果: 1 件」。押しても0件になるタグが上位に居座ることもあった。
describe("絞り込み中のタグの件数", () => {
    const chips = () => screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label") ?? "");

    it("いま出ている結果の中で数える", async () => {
        // fuji は travel 2枚（p4/p5）＋ food 1枚。food で絞れば 1枚
        window.history.replaceState({}, "", "/?category=food");
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getByText(/結果: 4 件/)).toBeInTheDocument());

        const fuji = chips().filter((l) => l.toLowerCase().startsWith("fuji"));
        expect(fuji, "全体の枚数を出している（押すと結果と食い違う）").toEqual(["fuji"]);
    });

    it("結果に1枚も無いタグはチップに出さない", async () => {
        window.history.replaceState({}, "", "/?category=food");
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getByText(/結果: 4 件/)).toBeInTheDocument());

        expect(chips().some((l) => l.startsWith("night")),
            "押しても0件のチップが並んでいる").toBe(false);
    });

    it("絞っていなければ今までどおり全部の枚数（正常系）", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        expect(chips()).toContain("fuji (3)");
    });
});

// **絞り込むとチップの字面と並びが動いていた。**
//
// 代表表記（いちばん多い表記）を絞り込み後の集合で決めていたので、
// 検索1文字ごとに `fuji` ⇄ `Fuji` が入れ替わり、並び順も動いた
// ——押そうとした位置がずれる。`e731478` で「写真が1枚増えるだけで
// 入れ替わる」を潰したのと同じ性質なので、母集団は全体に固定する。
describe("絞り込んでもチップの字面と並びは動かない", () => {
    const chipsOf = () => screen.getAllByRole("switch")
        .map((el) => (el.getAttribute("aria-label") ?? "").replace(/ \(\d+\)$/, ""));

    /** 1画面ぶん描いてチップを読み、**必ず片付けてから**返す
     *  （片付けないと次の render のチップと混ざって数が合わなくなる） */
    async function chipsFor(url: string): Promise<string[]> {
        window.history.replaceState({}, "", url);
        const { unmount } = render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        const labels = chipsOf();
        unmount();
        return labels;
    }

    it("代表表記が絞り込みで入れ替わらない", async () => {
        const before = await chipsFor("/");
        const after = await chipsFor("/?category=travel");

        for (const label of after) {
            expect(before, `絞り込みで字面が変わった: ${label}`).toContain(label);
        }
    });

    it("並びも全体の枚数で決める（顔ぶれが減っても前後は変わらない）", async () => {
        const before = await chipsFor("/");
        const after = await chipsFor("/?category=travel");

        const kept = before.filter((t) => after.includes(t));
        expect(after, "絞り込みで並びが入れ替わっている").toEqual(kept);
    });
});

// 選択中のタグは、上位に無くても・結果が0件でも必ず出す
// （消えると解除できなくなる）
describe("選択中のタグの救済", () => {
    it("結果が0件でも、選択したタグのチップは残る", async () => {
        window.history.replaceState({}, "", "/?tags=night&q=zzzznomatch");
        render(<GalleryPageClient />);

        await waitFor(() => expect(screen.getByText(/条件に一致する写真がありません/)).toBeInTheDocument());
        const labels = screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label") ?? "");
        expect(labels, "解除するチップまで消えている").toContain("night");
    });
});
