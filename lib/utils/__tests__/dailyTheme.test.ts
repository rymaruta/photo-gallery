import { describe, it, expect } from "vitest";
import { DAILY_THEMES, dailyThemeFor, readThemeTag } from "../dailyTheme";
import { TAG_CHOICES } from "../tagChoices";

describe("今日のテーマ（iOS の DailyTheme と同じ割り当て）", () => {
    // iOS（Swift の `ordinality(of: .day, in: .era)`）で数えた値: 2026-10-15 → 739904、2027-03-01 → 740041
    it("アプリと同じ日に同じテーマ", () => {
        expect(dailyThemeFor(new Date(2026, 9, 15, 9)).tag).toBe(DAILY_THEMES[739904 % 7].tag);
        expect(dailyThemeFor(new Date(2026, 9, 15, 9)).tag).toBe("夜");
        expect(dailyThemeFor(new Date(2027, 2, 1, 23, 59)).tag).toBe(DAILY_THEMES[740041 % 7].tag);
    });

    it("端末の暦の1日で切り替わる（0時をまたぐと次）", () => {
        const a = dailyThemeFor(new Date(2026, 9, 15, 23, 59));
        const b = dailyThemeFor(new Date(2026, 9, 16, 0, 1));
        expect(a.tag).toBe("夜");
        expect(b.tag).toBe("花");
    });

    it("一覧と順番は iOS と同じ", () => {
        expect(DAILY_THEMES.map((t) => t.tag)).toEqual(["夕焼け", "山", "朝", "海", "夜", "花", "神社"]);
    });

    it("テーマのタグは決まった選択肢の中", () => {
        for (const t of DAILY_THEMES) expect(TAG_CHOICES).toContain(t.tag);
    });

    it("投稿画面の `?tag=` はテーマのタグだけ通す", () => {
        expect(readThemeTag("夜")).toBe("夜");
        expect(readThemeTag("春")).toBeNull();           // 選択肢にはあるがテーマではない
        expect(readThemeTag("<script>")).toBeNull();
        expect(readThemeTag("")).toBeNull();
        expect(readThemeTag(null)).toBeNull();
    });
});
