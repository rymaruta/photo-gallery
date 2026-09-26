import React from "react";
import { describe, it, vi } from "vitest";
import { render } from "@testing-library/react";
import MapControls from "../MapControls";
import { expectNoWhiteOnFill } from "../../components/__tests__/whiteOnFill";

/**
 * 地図の上の操作（検索・カテゴリのチップ・地図／リスト）。
 * 選択中のチップと切り替えは白の塗り。白いフォーカス枠が塗りに溶けていた
 * （2026-09-26 に真鍮へ直した）ので、描いた画面で見張る。
 */
describe("撮影地マップの操作", () => {
    it("選択中のチップ・切り替え（白の塗り）の上に白い文字・白いフォーカス枠が無い", () => {
        const { container } = render(
            <MapControls
                query="" onQueryChange={vi.fn()}
                categories={[{ slug: "landscape", count: 3 }, { slug: "architecture", count: 2 }]}
                category="landscape" onCategoryChange={vi.fn()}
                view="map" onViewChange={vi.fn()}
                locale="ja"
            />,
        );
        expectNoWhiteOnFill(container);
    });
});
