import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/react";
import type { Photo } from "../../../lib/data/photos";

/**
 * **撮影地の索引は「場所」と「地域」に分け、見出しは具体的な部分だけにする**
 * （2026-09-30 のレビュー: 「フランス」「パリ」「フランス ヴェルサイユ」が同じ一覧に並ぶ・
 * 長い住所がそのまま見出しになる）。**行き先は元の文字列のまま**（共有 URL を壊さない）。
 */
const P = (id: string, location: string): Photo => ({
    id, location, src: "https://cdn/x.jpg", createdAt: "2026-01-01T00:00:00Z",
} as Photo);
const photos: Photo[] = [
    P("a", "フランス"), P("b", "パリ"), P("c", "フランス ヴェルサイユ"),
    P("d", "香川県 観音寺市 高屋神社"), P("e", "山中湖"),
];
vi.mock("../../../lib/server/photos", () => ({ loadAllPhotos: async () => photos }));

const CollectionIndexPage = (await import("../CollectionIndexPage")).default;
const { collectEntries, collectionPath } = await import("../../../lib/utils/collections");

describe("撮影地の索引", () => {
    it("「場所」と「地域」の2つの節に分ける", async () => {
        const { container } = render(await CollectionIndexPage({ type: "location" }) as React.ReactElement);
        const places = container.querySelector("[aria-labelledby='loc-places']") as HTMLElement;
        const areas = container.querySelector("[aria-labelledby='loc-areas']") as HTMLElement;
        expect(within(places).getByRole("heading").textContent).toBe("場所");
        expect(within(areas).getByRole("heading").textContent).toBe("地域");
        const text = (el: HTMLElement) => [...el.querySelectorAll("a")].map((a) => a.textContent);
        expect(text(places).join("|")).toMatch(/高屋神社/);
        expect(text(places).join("|")).toMatch(/山中湖/);
        expect(text(areas).join("|")).toMatch(/フランス/);
        expect(text(areas).join("|")).toMatch(/パリ/);
        expect(text(areas).join("|")).toMatch(/ヴェルサイユ/);
        expect(text(places).join("|")).not.toMatch(/パリ|ヴェルサイユ/);
    });

    it("長い住所は見出しにしない（具体的な部分が先・地域は小さく添える）", async () => {
        const { container } = render(await CollectionIndexPage({ type: "location" }) as React.ReactElement);
        const link = [...container.querySelectorAll("a")].find((a) => (a.textContent ?? "").includes("高屋神社"))!;
        expect(link.textContent!.startsWith("高屋神社"), link.textContent!).toBe(true);
        expect(link.querySelector("span")?.textContent).toBe("香川県 観音寺市");
        // 元の文字列は title に残す（どの撮影地のページか分かる）
        expect(link.getAttribute("title")).toBe("香川県 観音寺市 高屋神社");
    });

    it("行き先は元の文字列のスラッグのまま（全件・共有 URL を壊さない）", async () => {
        const { container } = render(await CollectionIndexPage({ type: "location" }) as React.ReactElement);
        const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
        for (const e of collectEntries(photos, "location")) {
            expect(hrefs).toContain(collectionPath("location", e.slug));
        }
    });
});
