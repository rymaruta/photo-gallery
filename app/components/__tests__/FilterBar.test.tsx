import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterBar from "../FilterBar";
import type { FilterValues } from "../../../lib/types/gallery";

const baseValues: FilterValues = { category: "all", selectedTags: [], query: "", sort: "new", feed: "all" };

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

    it("選択済みタグをクリックすると解除される", () => {
        const { onChange } = setup({ values: { ...baseValues, selectedTags: ["swan"] } });
        fireEvent.click(screen.getByRole("switch", { name: /swan/ }));
        expect(onChange).toHaveBeenCalledWith({ selectedTags: [] });
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
        const clear = screen.getByRole("button", { name: "Clear" });
        fireEvent.click(clear);
        expect(onChange).toHaveBeenCalledWith({ selectedTags: [] });
    });

    it("タグ未選択ならクリアボタンは出ない", () => {
        setup();
        expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
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
