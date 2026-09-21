import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 一覧の1枚（owner の新デザインのカード）。
 *
 * **写真が先、投稿者が後**——モックは写真を一番上に置き、題と撮影地を写真の
 * 上に重ね、その下に投稿者の行を敷く。「写真が主役」（CLAUDE.md）と同じ向き。
 *
 * フォローの操作は境界としてモックする（押し心地は `FollowButton` 側の担当）。
 */
vi.mock("../FollowButton", () => ({
    FollowAction: ({ targetUserId }: { targetUserId: string }) =>
        <button type="button" data-follow={targetUserId}>フォロー</button>,
    default: () => null,
}));
vi.mock("../ProfileLink", () => ({
    default: ({ displayName }: { displayName: string }) => <span>{displayName}</span>,
}));

import TimelineCard from "../TimelineCard";

const base: Photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/u1/a.jpg",
    userId: "u1",
    displayName: "Yuta",
    title: "エーゲ海の夕景",
    location: "ギリシャ・サントリーニ島",
    description: "言葉を忘れるほど、美しい夕暮れだった。",
    tags: ["ギリシャ", "絶景"],
    likes: 1284,
    commentCount: 48,
};

const card = (p: Partial<Photo> = {}, props: Record<string, unknown> = {}) =>
    render(<TimelineCard photo={{ ...base, ...p }} locale="ja" {...props} />);

describe("一覧のカード", () => {
    it("題と撮影地を写真の上に重ねる（写真が主役）", () => {
        card();
        expect(screen.getByText("エーゲ海の夕景")).toBeTruthy();
        expect(screen.getByText("ギリシャ・サントリーニ島")).toBeTruthy();
    });

    it("🔴 題も撮影地も無ければ、帯ごと出さない（下だけ黒くならない）", () => {
        const { container } = card({ title: undefined, location: undefined });
        const band = Array.from(container.querySelectorAll<HTMLElement>("div"))
            .filter((d) => d.style.background.includes("linear-gradient"));
        expect(band, "空の帯が残っている").toHaveLength(0);
    });

    it("説明とタグを出す。タグは集約ページへのリンク", () => {
        card();
        expect(screen.getByText("言葉を忘れるほど、美しい夕暮れだった。")).toBeTruthy();
        const tag = screen.getByRole("link", { name: "#ギリシャ" });
        expect(tag.getAttribute("href")).toContain("/tag/");
    });

    it("🔴 同じタグを2回出さない（`#旅` と `旅` は同じ）", () => {
        card({ tags: ["旅", "#旅", "Travel", "travel"] });
        expect(screen.getAllByRole("link", { name: /^#/ }).map((a) => a.textContent))
            .toEqual(["#旅", "#Travel"]);
    });

    it("タグが多すぎても出しすぎない（写真より文字が多くならない）", () => {
        card({ tags: ["a", "b", "c", "d", "e", "f", "g"] });
        expect(screen.getAllByRole("link", { name: /^#/ })).toHaveLength(4);
    });

    it("🔴 いいね・コメントは押せる見た目のボタンにせず、写真ページへのリンクにする", () => {
        card();
        // 数字は出す
        expect(screen.getByText("1,284")).toBeTruthy();
        expect(screen.getByText("48")).toBeTruthy();
        // **押せないボタンを置かない。** 一覧で押せるようにすると写真ごとに
        // サーバーへ引きに行くことになる（N往復）
        expect(screen.queryByRole("button", { name: /いいね/ })).toBeNull();
        const like = screen.getByRole("link", { name: /いいね 1284件/ });
        expect(like.getAttribute("href")).toContain("p1");
    });

    it("複数枚なら「1/N」", () => {
        card({ extraImages: [{ src: "https://cdn.example.com/b.jpg" }] });
        expect(screen.getByText("1/2")).toBeTruthy();
    });

    it("🔴 壊れた要素は数えない（「1/3」と出して開くと2枚、を作らない）", () => {
        card({
            // @ts-expect-error 壊れた値を通す（本番のデータは何でもありうる）
            extraImages: [null, {}, { src: 5 }, { src: "" }, { src: "https://cdn.example.com/b.jpg" }],
        });
        expect(screen.getByText("1/2"), "壊れた要素まで数えている").toBeTruthy();
    });

    it("extraImages が配列でなくても落ちない", () => {
        card({ extraImages: "x" as unknown as Photo["extraImages"] });
        expect(screen.queryByText(/^1\//)).toBeNull();
    });

    it("1枚だけなら枚数を出さない", () => {
        card();
        expect(screen.queryByText(/^1\//)).toBeNull();
    });

    it("🔴 自分の写真にフォローを出さない（押しても断られる）", () => {
        card({}, { isAuthenticated: true, viewerId: "u1" });
        expect(screen.queryByRole("button", { name: "フォロー" })).toBeNull();
    });

    it("他人の写真にはフォローを出す", () => {
        card({}, { isAuthenticated: true, viewerId: "me" });
        expect(screen.getByRole("button", { name: "フォロー" }).getAttribute("data-follow")).toBe("u1");
    });

    it("投稿者が分からない古い行にはフォローを出さない", () => {
        card({ userId: undefined }, { isAuthenticated: true, viewerId: "me" });
        expect(screen.queryByRole("button", { name: "フォロー" })).toBeNull();
    });

    it("写真を押すと写真ページへ（先読みしない）", () => {
        const { container } = card();
        const link = container.querySelector("[data-photo-id]") as HTMLAnchorElement;
        expect(link.getAttribute("href")).toContain("p1");
    });
});
