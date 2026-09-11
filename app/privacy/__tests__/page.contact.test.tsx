import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
