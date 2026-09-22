import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

// **「10. お問い合わせ」は、宛先が無いと「準備中です」になる。**
//
// `NEXT_PUBLIC_CONTACT_EMAIL` は長いあいだ**どのビルドでも空**だった
// ——読むのは `lib/utils/seo.ts` だけで、`deploy.yml` がビルドに
// 渡していなかった（台帳には「未設定（owner の作業）」としか書いて
// いなかったので、設定すれば直ると思われていた）。
//
// この画面には**テストが1本も無かった**ので、分岐がどちらに倒れても
// 誰も気づかなかった。

vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: React.ReactNode }) =>
        <a href={href}>{children}</a>,
}));

const ADDRESS = "journey.photo.official@gmail.com";

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); });

/** `siteConfig` はモジュール読み込み時に env を読むので、先に差してから import する */
async function renderPrivacy(contactEmail: string | undefined) {
    if (contactEmail === undefined) vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "");
    else vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", contactEmail);
    const Page = (await import("../page")).default;
    render(<Page />);
}

describe("プライバシーポリシーのお問い合わせ先", () => {
    it("宛先があれば、住所とリンクを出す", async () => {
        await renderPrivacy(ADDRESS);

        const link = screen.getByRole("link", { name: ADDRESS });
        expect(link.getAttribute("href"), "mailto になっていない").toBe(`mailto:${ADDRESS}`);
        expect(screen.queryByText(/準備中です/), "宛先があるのに準備中と出している").toBeNull();
    });

    // 逆向き: 無いときに空のリンクを出さない（押せるのに何も起きない、を作らない）
    it("宛先が無ければ、準備中と言う（空のリンクを出さない）", async () => {
        await renderPrivacy(undefined);

        expect(screen.getByText(/準備中です/)).toBeInTheDocument();
        const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
        expect(mailtos, "宛先が無いのに mailto を出している").toHaveLength(0);
    });
});

/**
 * **「9. 退会・データの削除」が指す場所が、実際の置き場と合っているか。**
 *
 * 退会の口（`DeleteAccountModal`）は プロフィール編集 から `/user/settings` へ
 * 移したのに、この文だけ「プロフィール編集ページの『危険な操作』から」と
 * 言い続けていた——**移設前の場所を案内する**という、同じ回に直した
 * `api-user/src/follow.ts` のブロック解除の案内とまったく同じ形。
 *
 * ここは App Store 5.1.1(v)（アプリ内でのアカウント削除）の導線を説明する
 * 文でもあるので、ずれたまま置かない。
 *
 * **文字の一致だけで見ない。** 実際に `DeleteAccountModal` を読み込んで
 * いるのがどのページかまで見る——また移したときに、この文だけ取り残されない
 * ように。
 */
describe("プライバシーポリシーが指す退会の場所", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

    it("退会の口は設定ページにある（プロフィール編集には無い）", () => {
        expect(read("app/user/settings/page.tsx"),
            "設定ページが退会の口を持っていない").toContain("DeleteAccountModal");
        expect(read("app/user/profile/page.tsx"),
            "プロフィール編集に退会の口が戻っている。案内の文も見直すこと")
            .not.toContain("import DeleteAccountModal");
    });

    it("案内は「設定ページ」と言う（移設前の「プロフィール編集ページ」ではなく）", async () => {
        await renderPrivacy(ADDRESS);

        const body = document.body.textContent ?? "";
        expect(body, "退会の節が無い").toContain("退会（アカウント削除）");
        expect(body, "移設前の場所を案内している").not.toContain("プロフィール編集ページの「危険な操作」");
        expect(body, "設定ページだと言っていない").toContain("設定ページの「危険な操作」");
    });
});
