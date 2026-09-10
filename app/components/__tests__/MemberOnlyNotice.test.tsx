import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// この画面に落ちた人はアップロード・下書き・編集・アルバムが全部開けず、
// 直す手段が「連絡する」しかない。**その連絡先が無かった。**
const contact = vi.hoisted(() => ({ value: "" }));
vi.mock("../../../lib/utils/seo", () => ({
    get siteConfig() { return { contactEmail: contact.value }; },
}));

import MemberOnlyNotice from "../MemberOnlyNotice";

beforeEach(() => { contact.value = ""; });

describe("投稿の権限が無い人への案内", () => {
    it("連絡先があれば mailto を出す", () => {
        contact.value = "hi@example.com";
        render(<MemberOnlyNotice />);
        expect(screen.getByRole("link", { name: "問い合わせる" }))
            .toHaveAttribute("href", "mailto:hi@example.com");
    });

    // **未設定のときにプライバシーポリシーへ送らない。** あちらも同じ
    // 環境変数を見ていて「お問い合わせ先は準備中です。」と出す
    // ——1ホップの行き止まりが2ホップになるだけ（一度そうしていた）
    it("連絡先が無ければ、行き止まりのリンクを出さない", () => {
        render(<MemberOnlyNotice />);
        expect(screen.queryByRole("link", { name: "問い合わせる" })).toBeNull();
        expect(screen.queryByRole("link", { name: /問い合わせ先/ }), "準備中のページへ送っている").toBeNull();
        const links = screen.getAllByRole("link");
        expect(links, "出口はギャラリーへ戻るだけ").toHaveLength(1);
        expect(links[0]).toHaveAttribute("href", "/");
    });

    it("連絡先が無いときは、運営側の設定が要ることを言う", () => {
        render(<MemberOnlyNotice />);
        expect(screen.getByText(/運営側での設定が必要です/)).toBeInTheDocument();
    });

    // **本番で実際に出るのは「未設定」の枝**（`NEXT_PUBLIC_CONTACT_EMAIL` は
    // リポジトリのどこにも設定が無い）。連絡先を設定してから描いていた頃は、
    // **本番で走らない枝だけを固定していた**
    it("ログインし直しても直らないことを言う（連絡先が無くても）", () => {
        render(<MemberOnlyNotice />);
        expect(screen.getByText(/ログインし直しても直りません/)).toBeInTheDocument();
    });

    it("連絡先があるときも同じことを言う", () => {
        contact.value = "hi@example.com";
        render(<MemberOnlyNotice />);
        expect(screen.getByText(/ログインし直しても直りません/)).toBeInTheDocument();
    });

    // 英語の分岐は4つの文字列とも無検証だった
    it("英語でも、権限が無いことと直らないことを言う", () => {
        render(<MemberOnlyNotice locale="en" />);
        expect(screen.getByText(/can't post yet/)).toBeInTheDocument();
        expect(screen.getByText(/Signing in again won't fix it/)).toBeInTheDocument();
        expect(screen.getByText(/the site owner has to set it up/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Back to gallery" })).toBeInTheDocument();
    });
});
