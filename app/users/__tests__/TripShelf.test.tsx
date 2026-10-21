import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TripShelfList } from "../TripShelf";
import { shelfTrips, type TripPhoto } from "../../../lib/utils/tripBook";

/**
 * 旅の棚の札（2026-10-21）: 読み上げ名の区切りは言葉に合わせる（日本語「、」・英語 ", "）。
 * 表紙の札は写真の上なので、フォーカスの枠は白（真鍮は写真に溶ける）。
 */
const photo = (id: string, date: string, location: string): TripPhoto =>
    ({ id, src: `https://cdn/${id}.jpg`, userId: "u1", date, location, published: true } as TripPhoto);
const TRIPS = shelfTrips([
    photo("t1", "2026-09-12", "東京"), photo("t2", "2026-09-13", "東京"),
    photo("p1", "2024-10-11", "パリ"), photo("p2", "2024-10-12", "パリ"),
]);

describe("旅の棚の札", () => {
    it("英語では読み上げ名を \", \" で区切る（日本語の「、」を混ぜない）", () => {
        render(<TripShelfList trips={TRIPS} userId="u1" isJa={false} />);
        const cover = screen.getByTestId("trip-shelf-cover");
        const row = screen.getByTestId("trip-shelf-row");
        for (const el of [cover, row]) {
            const name = el.getAttribute("aria-label")!;
            expect(name).not.toContain("、");
            expect(name).toMatch(/^Trip to .+, \d{4}\./);
        }
    });

    it("日本語では「、」で区切る", () => {
        render(<TripShelfList trips={TRIPS} userId="u1" isJa />);
        expect(screen.getByTestId("trip-shelf-cover").getAttribute("aria-label")).toMatch(/^東京の旅、2026\.09\.12/);
    });

    it("表紙の札のフォーカスの枠は白（写真の上に真鍮を置かない）", () => {
        render(<TripShelfList trips={TRIPS} userId="u1" isJa />);
        const cls = screen.getByTestId("trip-shelf-cover").className;
        expect(cls).toContain("focus-visible:ring-white");
        expect(cls).not.toContain("focus-visible:ring-accent");
    });
});
