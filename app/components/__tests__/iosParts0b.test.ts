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

import { CHIP_ON, CHIP_OFF, CHIP_SIZE, CHIP_HIT } from "../chipStyles";
import { FIELD, SEARCH_FIELD, SEARCH_FIELD_STYLE } from "../fieldStyles";

describe("C5 チップ", () => {
    it("選ぶと白の塗り＋✓（色だけで伝えない）・未選択は白7%＋白8%の縁", () => {
        expect(CHIP_ON.split(/\s+/)).toEqual(expect.arrayContaining(["chip-check", "bg-primary", "text-ink"]));
        expect(CHIP_OFF.split(/\s+/)).toEqual(expect.arrayContaining(["bg-chip", "ring-1", "ring-line"]));
        const css = read("app/globals.css");
        const at = css.indexOf("@utility chip-check");
        expect(at).toBeGreaterThan(-1);
        const rule = css.slice(at, css.indexOf("\n}\n", at));
        expect(rule).toContain("order: -1");
        expect(rule).toMatch(/mask:/);
    });
    it("見た目 34・幅も 44 以上・当たりは上下 5 ずつ広げて 44（iOS PillChip）", () => {
        expect(CHIP_SIZE.minHeight).toBe("34px");
        expect(CHIP_SIZE.minWidth).toBe("44px");
        expect(CHIP_HIT).toContain("before:-inset-y-[5px]");
    });
    it.each([
        "app/components/FilterBar.tsx", "app/components/SpotIndexClient.tsx", "app/components/DiscoverRail.tsx",
        "app/components/SpotAreaIndexClient.tsx", "app/search/DiscoverSections.tsx", "app/photo/[id]/PhotoPageClient.tsx",
        "app/components/NotificationsBell.tsx",
    ])("%s のチップは当たり 44（CHIP_HIT）を持つ", (f) => {
        expect(read(f)).toContain("${CHIP_HIT}");
    });
    it("写真の詳細のタグは 32・12 の小さい札ではなく共通の寸法", () => {
        const src = read("app/photo/[id]/PhotoPageClient.tsx");
        expect(src).not.toContain("min-h-[32px] px-3 rounded-full ${CHIP_OFF} text-[12px]");
        expect(src).toContain("...CHIP_SIZE, touchAction");
    });
    it("お知らせの絞り込みも共通のチップ（選ぶと ✓）", () => {
        const src = read("app/components/NotificationsBell.tsx");
        expect(src).toContain("selected ? CHIP_ON : CHIP_OFF");
        expect(src).not.toContain("bg-white/[0.07] text-white/70");
    });
});

describe("C6 入力欄", () => {
    it("44・角 12・surface-2・白8%の縁（丸い端にしない）", () => {
        expect(FIELD.split(/\s+/)).toEqual(expect.arrayContaining(["rounded-field", "bg-surface-2", "ring-1", "ring-line"]));
        expect(SEARCH_FIELD).not.toContain("rounded-full");
        expect(SEARCH_FIELD_STYLE.minHeight).toBe("44px");
        expect(SEARCH_FIELD_STYLE.paddingLeft).toBe("41px");
    });
    it.each([
        ["app/components/FilterBar.tsx", "SEARCH_FIELD"],
        ["app/users/search/page.tsx", "SEARCH_FIELD"],
        ["app/map/MapControls.tsx", "SEARCH_FIELD"],
        ["app/user/settings/CloseFriends.tsx", "FIELD"],
        ["app/components/CommentSection.tsx", "FIELD"],
    ])("%s の欄は共通の形（%s）", (f, name) => {
        const src = read(f);
        expect(src).toContain(`{${name}}`.replace("{", "").replace("}", ""));
        expect(src).not.toMatch(/rounded-\[2[02]px\]/);
        expect(src).not.toMatch(/search-own-clear w-full rounded-full/);
    });
});
