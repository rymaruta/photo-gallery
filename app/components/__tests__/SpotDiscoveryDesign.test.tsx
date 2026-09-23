import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Spot } from "@/lib/data/spots";

vi.mock("../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));

import SpotDiscoveryStrip from "../SpotDiscoveryStrip";
import SpotIndexClient from "../SpotIndexClient";

const SPOTS = [
    {
        spotId: "sp_001",
        slug: "kappa-bashi",
        name: "河童橋",
        aliases: ["上高地の橋"],
        region: { country: "日本", prefecture: "長野県", city: "松本市" },
        category: "山と高原",
        summary: "梓川と山並みの景色を撮るためのガイド。",
    },
    {
        spotId: "sp_002",
        slug: "ginzan",
        name: "銀山温泉",
        region: { country: "日本", prefecture: "山形県", city: "尾花沢市" },
        category: "温泉街",
        summary: "温泉街を撮るためのガイド。",
    },
] as Spot[];

describe("公式スポットの発見UI", () => {
    it("公開スポットが無いときは写真検索の上に空の宣伝枠を作らない", () => {
        const { container } = render(<SpotDiscoveryStrip spots={[]} isJa />);
        expect(container.innerHTML).toBe("");
    });

    it("軽量なカード情報だけでガイドの実URLへ遷移する", () => {
        render(<SpotDiscoveryStrip isJa spots={[{
            slug: SPOTS[0].slug, name: SPOTS[0].name, region: "長野県 松本市",
        }]} />);
        expect(screen.getByRole("heading", { name: "景色から、旅先を見つける" })).toBeTruthy();
        expect(screen.getByRole("link", { name: /河童橋/ }).getAttribute("href")).toBe("/spots/kappa-bashi");
    });

    it("名称・別名・地域で公開済みスポットだけを検索する", () => {
        render(<SpotIndexClient spots={SPOTS} />);
        const q = screen.getByRole("searchbox");
        fireEvent.change(q, { target: { value: "上高地の橋" } });
        expect(screen.getByRole("link", { name: /河童橋/ })).toBeTruthy();
        expect(screen.queryByRole("link", { name: /銀山温泉/ })).toBeNull();
        fireEvent.change(q, { target: { value: "山形県" } });
        expect(screen.getByRole("link", { name: /銀山温泉/ })).toBeTruthy();
        expect(screen.queryByRole("link", { name: /河童橋/ })).toBeNull();
    });

    it("登録のない検索語は架空のおすすめで埋めない", () => {
        render(<SpotIndexClient spots={SPOTS} />);
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "存在しない撮影地" } });
        expect(screen.getByText("条件に合う撮影スポットがありません。")).toBeTruthy();
        expect(screen.queryAllByRole("link", { name: /撮影ガイドを見る/ })).toHaveLength(0);
    });
});
