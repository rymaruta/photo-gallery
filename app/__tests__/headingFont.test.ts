import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MINCHO_STACK } from "../../lib/utils/storyText";

/**
 * **大見出しの明朝（Shippori Mincho B1 Bold）を自分のサーバーから配る**（2026-10-21・板 DesignSystem 02
 * 「WEB h1 だけ Shippori 700 を自己ホスト」）。
 *
 * 字のファイルは `app/layout.tsx` の next/font（ビルド時に取り込み、このサイトから配る）。
 * ここで縛るのは:
 *   - 写真ページの題（h1）が読む `MINCHO_STACK` の**先頭が自前の明朝**で、後ろに端末の明朝が続くこと
 *   - 太さ 700 だけ・`display: swap`・先読みしない（見出しの無いページに重さを足さない）
 *   - 配る字のライセンス（SIL OFL 1.1）を画面に出していること
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("見出しの明朝", () => {
    it("MINCHO_STACK の先頭は自前の明朝、落ちるまでは端末の明朝・最後は総称", () => {
        const parts = MINCHO_STACK.split(",").map((s) => s.trim());
        expect(parts[0]).toBe("var(--font-mincho)");
        expect(parts).toContain('"Hiragino Mincho ProN"');
        expect(parts[parts.length - 1]).toBe("serif");
    });

    it("next/font の指定: 700 だけ・swap・先読みしない・変数は --font-mincho", () => {
        const layout = read("app/layout.tsx");
        const m = /Shippori_Mincho_B1\(\{([\s\S]*?)\}\)/.exec(layout);
        expect(m, "Shippori Mincho B1 を読んでいない").toBeTruthy();
        const opts = m![1];
        expect(opts).toMatch(/weight:\s*\["700"\]/);
        expect(opts).toMatch(/display:\s*"swap"/);
        expect(opts).toMatch(/preload:\s*false/);
        expect(opts).toMatch(/variable:\s*"--font-mincho"/);
    });

    it("写真ページの題は MINCHO_STACK を読む", () => {
        const page = read("app/photo/[id]/PhotoPageClient.tsx");
        expect(page).toMatch(/import \{ MINCHO_STACK as MINCHO \} from "@\/lib\/utils\/storyText"/);
        expect(page).toMatch(/<h1[^>]*fontFamily: MINCHO/);
    });

    it("ライセンスの表示がフッターにある（SIL OFL 1.1）", () => {
        const footer = read("app/components/Footer.tsx");
        expect(footer).toContain("Shippori Mincho B1");
        expect(footer).toContain("SIL Open Font License 1.1");
        expect(footer).toContain('href="/licenses/ShipporiMinchoB1-OFL.txt"');
        // 置いたライセンスの全文は配布元の写し（著作権表示と OFL 1.1 の本文）
        const ofl = read("public/licenses/ShipporiMinchoB1-OFL.txt");
        expect(ofl).toMatch(/^Copyright 2021 The Shippori Mincho Project Authors/);
        expect(ofl).toContain("SIL OPEN FONT LICENSE Version 1.1");
    });
});
