import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterBar from "../FilterBar";
import type { FilterValues } from "../../../lib/types/gallery";
import { expectNoWhiteOnFill } from "./whiteOnFill";

const baseValues: FilterValues = { category: "all", selectedTags: [], query: "", sort: "new", scope: "all" };

function setup(over: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
    const onChange = vi.fn();
    render(
        <FilterBar
            categories={["nature", "landscape"]}
            tags={["swan", "lake", "moss", "tree", "paris", "night", "igloo", "sauna"]}
            values={baseValues}
            onChange={onChange}
            locale="ja"
            {...over}
        />,
    );
    return { onChange };
}

describe("FilterBar", () => {
    it("「すべて」と各カテゴリのチップが描画され、選択中に aria-pressed が付く", () => {
        setup();
        expect(screen.getByRole("button", { name: "すべて" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "自然" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "風景" })).toBeInTheDocument();
    });

    it("カテゴリチップのクリックで onChange が呼ばれる", () => {
        const { onChange } = setup();
        fireEvent.click(screen.getByRole("button", { name: "自然" }));
        expect(onChange).toHaveBeenCalledWith({ category: "nature" });
    });

    it("タグチップのクリックで selectedTags がトグルされる", () => {
        const { onChange } = setup();
        fireEvent.click(screen.getByRole("switch", { name: /swan/ }));
        expect(onChange).toHaveBeenCalledWith({ selectedTags: ["swan"] });
    });

    it("選んだタグのチップ（白の塗り）の件数が白で消えない", () => {
        // 件数は2枚以上で出る。選んだチップだけ文字色が別の文字列で決まっていた
        setup({ values: { ...baseValues, selectedTags: ["swan"] }, tagCounts: { swan: 3, lake: 2 } });
        const chip = screen.getByRole("switch", { name: /swan/ });
        expect(chip.textContent).toContain("3");
        expectNoWhiteOnFill(chip.parentElement!);
    });

    it("選択済みタグをクリックすると解除される", () => {
        const { onChange } = setup({ values: { ...baseValues, selectedTags: ["swan"] } });
        fireEvent.click(screen.getByRole("switch", { name: /swan/ }));
        expect(onChange).toHaveBeenCalledWith({ selectedTags: [] });
    });

    // **同じタグが2つに割れていた。** 集約ページの404救済は
    // `?tags=<スラッグ>` に振り替えるので、選択が `mount-fuji`、チップが
    // `Mount Fuji` という食い違いが普通に起きる。完全一致で見ていた頃は、
    // 生のチップが未選択のまま並び、押しても外れずに**2つ目が足される**
    // だけだった。
    it("スラッグ形で選ばれていても、生のタグのチップが選択済みになる", () => {
        setup({ tags: ["Mount Fuji", "night"], values: { ...baseValues, selectedTags: ["mount-fuji"] } });
        expect(screen.getByRole("switch", { name: /Mount Fuji/ }),
            "同じタグなのに選択済みになっていない").toHaveAttribute("aria-checked", "true");
    });

    it("スラッグ形の選択を、生のタグのチップから解除できる", () => {
        const { onChange } = setup({
            tags: ["Mount Fuji", "night"],
            values: { ...baseValues, selectedTags: ["mount-fuji"] },
        });
        fireEvent.click(screen.getByRole("switch", { name: /Mount Fuji/ }));
        expect(onChange, "押しても外れず、2つ目が足されている").toHaveBeenCalledWith({ selectedTags: [] });
    });

    it("大文字違いも同じタグとして扱う", () => {
        setup({ tags: ["Fuji"], values: { ...baseValues, selectedTags: ["fuji"] } });
        expect(screen.getByRole("switch", { name: /Fuji/ })).toHaveAttribute("aria-checked", "true");
    });

    it("渡されたタグはすべて1行に並ぶ（展開ボタンは廃止）", () => {
        setup(); // 8 タグ
        expect(screen.getByRole("switch", { name: /swan/ })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: /sauna/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
        expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
    });

    it("クリアボタンはタグ選択時のみ表示され、クリックで全解除する", () => {
        const { onChange } = setup({ values: { ...baseValues, selectedTags: ["swan", "lake"] } });
        const clear = screen.getByRole("button", { name: "選択を解除" });
        fireEvent.click(clear);
        expect(onChange).toHaveBeenCalledWith({ selectedTags: [] });
    });

    it("タグ未選択ならクリアボタンは出ない", () => {
        setup();
        expect(screen.queryByRole("button", { name: "選択を解除" })).toBeNull();
    });

    // 以前は辞書に actions が無く、日本語UIでも英語の "Clear" が出ていた。
    // 言語ごとに正しい文言が出ることを固定する。
    it("クリアボタンの文言は言語で切り替わる", () => {
        setup({ locale: "en", values: { ...baseValues, selectedTags: ["swan"] } });
        expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "選択を解除" })).toBeNull();
    });

    it("検索入力は300msのデバウンス後に onChange が呼ばれる", async () => {
        vi.useFakeTimers();
        try {
            const { onChange } = setup();
            fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
            expect(onChange).not.toHaveBeenCalled();
            vi.advanceTimersByTime(350);
            expect(onChange).toHaveBeenCalledWith({ query: "京都" });
        } finally {
            vi.useRealTimers();
        }
    });

    it("並び替えメニューを開いて選択できる", () => {
        const { onChange } = setup();
        fireEvent.click(screen.getByRole("button", { name: /新しい順/ }));
        fireEvent.click(screen.getByRole("option", { name: "古い順" }));
        expect(onChange).toHaveBeenCalledWith({ sort: "old" });
    });
});

// **外側タップで閉じるのが `mousedown` だけだった。**
//
// iOS は「押せない要素」に互換マウスイベントを合成しないことがあるので、
// グリッドの余白をタップしても閉じない（このリポジトリは `globals.css` に
// 「button/a に cursor:pointer が無いとタップが効かない」という同種の記録を
// 既に持っている）。スマホには Esc も無いので、閉じ損なうと開きっぱなし。
describe("並び替えメニューを閉じる", () => {
    it("外側の pointerdown で閉じる", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: /並び替え|新しい順/ }));
        expect(screen.getByRole("listbox")).toBeInTheDocument();

        fireEvent.pointerDown(document.body);

        expect(screen.queryByRole("listbox"), "外側をタップしても閉じない").toBeNull();
    });

    it("メニューの中の pointerdown では閉じない", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: /並び替え|新しい順/ }));
        const menu = screen.getByRole("listbox");

        fireEvent.pointerDown(menu);

        expect(screen.getByRole("listbox"), "中を触っただけで閉じている").toBeInTheDocument();
    });
});

/**
 * **`aria-controls` は、指す先が在るときだけ書く。**
 *
 * 並び替えの一覧（`id="sort-menu"`）は開いたときだけ描かれる。無条件に
 * 書いていたので、**閉じているトップページ**が存在しない id を指していた
 * （2026-09-12 に `out/` の141ページを走査して判明。`HeaderNav` と同じ形が
 * 2か所にあった）。状態は `aria-expanded` が伝える。
 */
describe("並び替えボタンの aria-controls", () => {
    it("閉じている間は、存在しない id を指さない", () => {
        setup();
        const btn = screen.getByRole("button", { expanded: false, name: /並び|順/ });
        expect(btn.getAttribute("aria-controls"), "閉じているのに id を指している").toBeNull();
        expect(document.getElementById("sort-menu")).toBeNull();
    });

    it("開いたら指す。そしてその id は実在する", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { expanded: false, name: /並び|順/ }));
        const btn = screen.getByRole("button", { expanded: true });
        const ref = btn.getAttribute("aria-controls");
        expect(ref, "開いているのに指していない").toBe("sort-menu");
        expect(document.getElementById(ref!), "指す先が存在しない").not.toBeNull();
    });
});

/**
 * **PC では左の柱に置く**（`/search` の ≥1024px・指示書 4・11・17）。
 *
 * jsdom はメディアクエリを解かないので、ここで見られるのは
 * 「`lg:` のクラスが付いているか」まで。実際の位置は Chromium で測った
 * （台帳の「PC の設計を入れた」の節）。
 */
describe("PC の柱（/search の ≥1024px）", () => {
    it("🔴 並び替えの一覧は PC で左に揃える（右揃えのままだと柱からはみ出す）", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { expanded: false, name: /並び|順/ }));
        const menu = document.getElementById("sort-menu")!;
        // 柱では箱がボタンの幅（約76px）まで縮むので、`right-0` のままだと
        // 幅 130px の一覧の左端が **x=-14** になる（実測・スクロールでも出てこない）
        expect(menu.className, "PC で左揃えに切り替えていない").toContain("lg:left-0");
        expect(menu.className, "右揃えを外していない（両方効くと右が勝つ）").toContain("lg:right-auto");
    });

    it("🔴 溢れる行は、PC では折り返す（横スクロールは指の作法）", () => {
        setup();
        const rows = [...document.querySelectorAll("div")].filter((d) => d.className.includes("overflow-x-auto"));
        expect(rows.length, "溢れる行が見つからない").toBeGreaterThan(0);
        for (const r of rows) {
            expect(r.className, "PC で折り返させていない").toContain("lg:flex-wrap");
            // `overflow-x-auto` と `flex-wrap` は共存できないので、戻してから折り返す
            expect(r.className, "`overflow-visible` に戻していない＝折り返しが効かない").toContain("lg:overflow-visible");
        }
    });
});
