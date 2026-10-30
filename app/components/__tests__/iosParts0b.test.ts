// 束 0b（2026-10-30・#420）: 部品を iOS の値にそろえた分の見張り。直しを戻すと落ちる
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TAB_ON, TAB_OFF, TAB_BASE, TAB_ROW } from "../tabStyles";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("C4 切り替え（文字の札）", () => {
    it("選んでいない札は text-3（#9A9A9A）・字は 15 semibold で太さを変えない", () => {
        expect(TAB_OFF).toContain("text-text-3");
        expect(TAB_OFF).not.toMatch(/text-white\/60/);
        expect(TAB_BASE).toContain("text-[15px]");
        expect(TAB_BASE).toContain("font-semibold");
        expect(TAB_BASE).toContain("min-h-[44px]");
        expect(TAB_ON).toContain("text-accent");
    });
    it("並びは名前の幅で左から・間 24・下に白8%の線", () => {
        expect(TAB_ROW).toContain("gap-[24px]");
        expect(TAB_ROW).toContain("border-line");
        expect(TAB_ROW).not.toContain("flex-1");
    });
    it("写真の詳細のコメント／関連写真は 2 等分の札ではなく共通の札", () => {
        const src = read("app/photo/[id]/PhotoPageClient.tsx");
        const at = src.indexOf('id={`photo-tab-${tab.key}`}');
        const block = src.slice(at - 300, at + 700);
        expect(block).toContain("TAB_BASE");
        expect(block).not.toContain("flex-1 pb-2.5");
        expect(src).toMatch(/className=\{TAB_ROW\}/);
    });
    it("ホームと人のページの札も共通の字（TAB_BASE）を使う", () => {
        expect(read("app/GalleryPageClient.tsx")).toContain("${TAB_BASE} ${active ? TAB_ON : TAB_OFF}");
        expect(read("app/users/UserProfileClient.tsx")).toContain("${TAB_BASE} ${active ? TAB_ON : TAB_OFF}");
    });
});
