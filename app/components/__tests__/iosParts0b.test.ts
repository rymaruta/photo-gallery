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
    // 2026-10-31 束 1 P11: 写真の詳細はコメントと関連写真の切り替えそのものをやめ、縦に節で並べた（iOS と同じ）
    it("写真の詳細はコメント／関連写真の切り替えを持たない（2 等分の札にも戻さない）", () => {
        const src = read("app/photo/[id]/PhotoPageClient.tsx");
        expect(src).not.toContain('role="tablist"');
        expect(src).not.toContain("flex-1 pb-2.5");
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
        "app/components/SpotAreaIndexClient.tsx", "app/photo/[id]/PhotoPageClient.tsx",
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

import { INLINE_BTN, INLINE_BTN_STYLE, FOLLOW_ON, FOLLOW_OFF } from "../buttonStyles";
import { TILE, TILE_MIN_H, TILE_TEXT, TILE_OFF } from "../SaveSpotButton";
import { CARD, ROW, ROW_TALL, ROW_TITLE, ROW_SUB } from "../rowStyles";
import { STATE_ACTION_CLASS, STATE_RETRY_CLASS } from "../StateViews";

describe("C7 ボタン（主 50・副 44）と行動の札", () => {
    it("空の一手は主ボタン 50（真鍮の塗り＋墨）、失敗の「もう一度」は副ボタン 44（白14%の線）", () => {
        expect(STATE_ACTION_CLASS).toContain("min-h-[50px]");
        expect(STATE_ACTION_CLASS).toContain("bg-accent-fill");
        expect(STATE_RETRY_CLASS).toContain("min-h-[44px]");
        expect(STATE_RETRY_CLASS).toContain("ring-line-strong");
    });
    it("撮影スポットの行動の札は iOS の actionLabel（64・角 14・印を字の上・13 semibold・白7%）", () => {
        expect(TILE_MIN_H).toBe(64);
        expect(TILE).toContain("flex-col");
        expect(TILE).not.toMatch(/min-\[390px\]:flex-row/);
        expect(TILE).toContain("rounded-xl");
        expect(TILE_TEXT).toContain("text-[13px]");
        expect(TILE_OFF).toContain("bg-chip");
    });
});

describe("C8 フォロー", () => {
    it("見た目 36・13 semibold・当たり 44（上下 4）・未フォローは白＋墨、フォロー中は白12%＋白18%の縁", () => {
        expect(INLINE_BTN_STYLE.minHeight).toBe("36px");
        expect(INLINE_BTN_STYLE.fontSize).toBe("13px");
        expect(INLINE_BTN).toContain("before:-inset-y-[4px]");
        expect(FOLLOW_OFF).toContain("bg-primary");
        expect(FOLLOW_OFF).toContain("text-ink");
        expect(FOLLOW_ON.split(/\s+/)).toEqual(expect.arrayContaining(["bg-white/12", "ring-white/18", "text-white"]));
    });
    it("場面ごとの形（真鍮の線・44 の白・32 の錠剤）に戻っていない", () => {
        const src = read("app/components/FollowButton.tsx");
        const at = src.indexOf("export function FollowAction");
        const body = src.slice(at);
        expect(body).toContain("${INLINE_BTN}");
        expect(body).not.toContain("ring-accent text-accent");
        expect(body).not.toContain('minHeight: "32px"');
        expect(body).not.toContain("UserPlusIcon");
    });
});

describe("C11 札と行", () => {
    it("札は surface・白8%の縁・角 16、行は 1行 52／二行 64（iOS JPHeight）・題 15 semibold・副 12 text-2", () => {
        expect(CARD.split(/\s+/)).toEqual(expect.arrayContaining(["bg-surface", "ring-1", "ring-line", "rounded-2xl"]));
        expect(ROW.split(/\s+/)).toContain("min-h-[52px]");
        expect(ROW.split(/\s+/).filter((c) => c.startsWith("min-h-"))).toHaveLength(1);
        expect(ROW_TALL.split(/\s+/)).toContain("min-h-[64px]");
        expect(ROW_TALL.split(/\s+/).filter((c) => c.startsWith("min-h-"))).toHaveLength(1);
        expect(ROW_TITLE).toContain("text-[15px]");
        expect(ROW_TITLE).toContain("font-semibold");
        expect(ROW_SUB).toContain("text-text-2");
        expect(ROW_SUB).toContain("text-[12px]");
    });
    it.each([
        ["app/components/SpotRows.tsx", "className={ROW_TALL}"],
        ["app/components/HomeEntryRow.tsx", "${ROW_CARD}"],
        ["app/photo/[id]/PhotoTripSection.tsx", "${ROW_CARD}"],
    ])("%s は共通の行を使う", (f, needle) => {
        expect(read(f)).toContain(needle);
    });
});

describe("C17 読み込み中・失敗", () => {
    it("写真の詳細・人のページ・旅の一冊の読み込み中は回る輪ではなく灰の骨組み", () => {
        for (const f of ["app/users/page.tsx", "app/users/trip/page.tsx"]) {
            const src = read(f);
            expect(src, f).toContain("<LoadingState");
            expect(src, f).not.toContain("animate-spin");
        }
        const photo = read("app/photo/[id]/PhotoPageClient.tsx");
        expect(photo).toContain('<LoadingState kind="rows"');
        expect(photo).toContain("<ErrorState");
        expect(photo).not.toContain("w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin");
    });
});

import { GLASS_BTN } from "../buttonStyles";
import { STAT_LABEL_PX, STAT_NUMBER_CLASS, STAT_LABEL_CLASS, STAT_CELL_CLASS, STAT_FIGURE_LARGE_PX } from "../statCellStyle";

describe("C10 節の見出し", () => {
    it("「すべて見る」は iOS の MoreLink（13・text-2・›・当たり 44）で、SectionHead もそれを使う", () => {
        const src = read("app/components/SectionHead.tsx");
        expect(src).toContain("export function MoreLink");
        expect(src).toMatch(/min-h-\[44px\] min-w-\[44px\] text-text-2/);
        expect(src).toContain("<MoreLink href={href} label={moreLabel} />");
        expect(src).toContain("export function SectionTitle");
    });
    it("写真の詳細の節の見出しは Shippori（font-serif）18。ヒラギノ明朝 19 に戻らない", () => {
        const src = read("app/photo/[id]/PhotoPageClient.tsx");
        expect(src).not.toMatch(/fontSize: "19px", lineHeight: 1\.3, fontFamily: MINCHO/);
        expect(src.match(/id="photo-nearby(-spots)?-heading" className="m-0 (mb-3 )?font-serif font-bold" style=\{\{ fontSize: "18px"/g)?.length).toBe(2);
        expect(src).not.toContain('"地図で見る ›"');
    });
});

describe("C12 写真の上の丸ボタン", () => {
    it("44・黒55%＋ぼかし 18＋白10%の縁", () => {
        expect(GLASS_BTN.split(/\s+/)).toEqual(expect.arrayContaining(["w-[44px]", "h-[44px]", "rounded-full", "bg-black/55", "backdrop-blur-[18px]", "ring-glass-line"]));
    });
    it.each(["app/users/UserProfileClient.tsx", "app/users/trip/TripBookClient.tsx", "app/components/SpotPageClient.tsx"])("%s は共通のガラスの丸を使う", (f) => {
        const src = read(f);
        expect(src).toContain("GLASS_BTN");
        expect(src).not.toMatch(/w-9 h-9 rounded-full bg-black\/40/);
    });
});

describe("C14 数", () => {
    it("数は 20 semibold の等幅、名前は 12 text-3、左寄せで区切り線なし（iOS ProfileStat）", () => {
        expect(STAT_NUMBER_CLASS).toContain("font-semibold");
        expect(STAT_NUMBER_CLASS).toContain("tabular-nums");
        expect(STAT_LABEL_PX).toBe(12);
        expect(STAT_LABEL_CLASS).toContain("text-text-3");
        expect(STAT_CELL_CLASS).toContain("text-left");
        expect(STAT_FIGURE_LARGE_PX).toBe(28);
        for (const f of ["app/users/UserProfileClient.tsx", "app/components/FollowButton.tsx"]) {
            expect(read(f), f).not.toContain("STAT_DIVIDER_PX");
        }
        expect(read("app/users/TravelRecord.tsx")).not.toContain('fontSize: "30px"');
    });
});

describe("C16 印の線", () => {
    it("Heroicons の線の印は、既定の 1.5 のものだけ 1.6 に（属性で太くした印は選ばない）", () => {
        const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
        expect(css).toMatch(/:where\(svg\[data-slot="icon"\]\[fill="none"\]\[stroke-width="1\.5"\]\)\s*\{\s*stroke-width:\s*1\.6;/);
        // 絞らない選び方に戻っていない（SVG の属性は :where にも負けて、太くした印が細る）
        expect(css).not.toMatch(/:where\(svg\[data-slot="icon"\]\[fill="none"\]\)/);
    });
    it.each([
        ["app/components/stories/StoriesBar.tsx", "<PlusIcon className=\"w-3.5 h-3.5\" strokeWidth={3} />"],
        ["app/components/stories/HighlightsRow.tsx", "<PlusIcon className=\"w-7 h-7 text-white/90\" strokeWidth={2} />"],
        ["app/components/stories/HighlightsRow.tsx", "<PencilIcon className=\"w-3 h-3\" strokeWidth={2.5} />"],
        ["app/user/highlights/page.tsx", "<CheckIcon className=\"w-3.5 h-3.5\" strokeWidth={3} />"],
        ["app/users/UserProfileClient.tsx", "strokeWidth={2.5} />"],
        ["app/user/profile/page.tsx", "strokeWidth={"],
    ])("%s の太くした印は属性で太さを持つ（1.5 ではない＝1.6 の規則に選ばれない）", (f, needle) => {
        const src = read(f);
        expect(src).toContain(needle);
        const m = needle.match(/strokeWidth=\{([\d.]+)\}/);
        if (m) expect(Number(m[1])).not.toBe(1.5);
    });
    it.each(["app/components/GalleryModal/ModalControls.tsx", "app/components/Thumb.tsx"])("%s の手で書いた印は 1.6", (f) => {
        expect(read(f)).not.toMatch(/strokeLinejoin="round" strokeWidth=\{2\} d=/);
    });
});


import { PROFILE_FOLLOW_BTN, PROFILE_FOLLOW_STYLE, PROFILE_FOLLOW_ON, PROFILE_FOLLOW_OFF, FOLLOW_LIST_MIN_W } from "../buttonStyles";

describe("束 0b の確かめの直し", () => {
    it("C8 人のページのフォローは iOS の ProfileFollowButtonLabel（40・15 semibold・左右 22/18・フォロー中は透明＋白14%の線と ▾）", () => {
        expect(PROFILE_FOLLOW_STYLE.minHeight).toBe("40px");
        expect(PROFILE_FOLLOW_STYLE.fontSize).toBe("15px");
        expect(PROFILE_FOLLOW_BTN).toContain("font-semibold");
        expect(PROFILE_FOLLOW_BTN).toContain("before:-inset-y-[2px]");
        expect(PROFILE_FOLLOW_OFF.split(/\s+/)).toEqual(expect.arrayContaining(["bg-primary", "text-ink", "px-[22px]"]));
        expect(PROFILE_FOLLOW_ON.split(/\s+/)).toEqual(expect.arrayContaining(["bg-transparent", "ring-line-strong", "px-[18px]"]));
        const src = read("app/components/FollowButton.tsx");
        expect(src).toMatch(/variant === "profile"\s*\? `\$\{PROFILE_FOLLOW_BTN\}/);
        expect(src).toContain("<ChevronDownIcon");
    });
    it("人を探すの一覧のフォローは幅の下限 96（押し替えで揺れない）", () => {
        expect(FOLLOW_LIST_MIN_W).toBe("96px");
        expect(read("app/users/search/page.tsx")).toMatch(/<FollowAction\s+variant="list"/);
        expect(read("app/components/FollowButton.tsx")).toContain('variant === "list" ? { minWidth: FOLLOW_LIST_MIN_W }');
    });
    it("C5 gap-1.5 のチップでは ✓ と字の間を 4 に詰める", () => {
        const css = read("app/globals.css");
        const at = css.indexOf("@utility chip-check");
        const rule = css.slice(at, css.indexOf("\n}\n", at));
        expect(rule).toMatch(/&:where\(\.gap-1\\\.5\)::after\s*\{\s*margin-inline-end:\s*-2px;/);
    });
    it("コメントの欄は字 16（iPhone の Safari が拡大しない）", () => {
        const src = read("app/components/CommentSection.tsx");
        const at = src.indexOf("<textarea");
        const tag = src.slice(at, src.indexOf("/>", at));
        expect(tag).toContain("${FIELD}");
        expect(tag).toMatch(/fontSize: "16px"/);
    });
    it("絞り込みの横に流すチップの並びは上下 5px の余白を持つ（当たり 44 が並びの中に収まる）", () => {
        const src = read("app/components/FilterBar.tsx");
        const m = src.match(/const WRAPPING_ROW = "([^"]*)"/);
        expect(m).not.toBeNull();
        const cls = m![1].split(/\s+/);
        expect(cls).toEqual(expect.arrayContaining(["py-[5px]", "-my-[5px]", "overflow-x-auto"]));
    });
});
