import { describe, it, expect } from "vitest";
import {
    UNITS, readNameSide, nameSideChanges, readBadgeProgress, progressText, ownShelf, othersShelf,
    earlyMarkShown, hasEarlyMemberQualification,
    type NameSide,
} from "../badgeShelf";
import { sanitizeProfile } from "../../utils/profileShape";

// 名前の横の設定とメダルの棚（2026-10-11 owner の決定。iOS と同じ）

const AT = "2026-10-01T00:00:00.000Z";

describe("readNameSide: 初期値は自分のプロフィールの生の値から", () => {
    it("🔴 印を外している人（proMarkStyle: none）は「外す」で開く（profileShape は iris に読み替える）", () => {
        const raw = { userId: "me", proMarkStyle: "none", pro: true };
        expect(readNameSide(raw)?.proMarkStyle).toBe("none");
        // 公開の形を整える関数を通すと iris になる——だから設定はこちらを通さない
        expect(sanitizeProfile<{ proMarkStyle: string }>(raw, "t")?.proMarkStyle).toBe("iris");
    });

    it("plate はそのまま、知らない値・無しは iris", () => {
        expect(readNameSide({ proMarkStyle: "plate" })?.proMarkStyle).toBe("plate");
        expect(readNameSide({ proMarkStyle: "gold" })?.proMarkStyle).toBe("iris");
        expect(readNameSide({})?.proMarkStyle).toBe("iris");
    });

    it("verifiedMarkOff は true のときだけ真（文字の \"true\" は読み替えない）", () => {
        expect(readNameSide({ verified: true, verifiedMarkOff: true })).toMatchObject({ verified: true, verifiedMarkOff: true });
        expect(readNameSide({ verified: true, verifiedMarkOff: "true" })?.verifiedMarkOff).toBe(false);
        expect(readNameSide({ verified: true })?.verifiedMarkOff).toBe(false);
    });

    it("飾るメダルは持っているものだけ（持っていない鍵は「選んでいない」）", () => {
        expect(readNameSide({ badges: { first: { tier: 1, at: AT } }, displayBadge: "first" })?.displayBadge).toBe("first");
        expect(readNameSide({ badges: { first: { tier: 1, at: AT } }, displayBadge: "wish" })?.displayBadge).toBeNull();
    });

    it("オブジェクトでない応答は null（取れなかった）", () => {
        expect(readNameSide(null)).toBeNull();
        expect(readNameSide([])).toBeNull();
    });
});

describe("nameSideChanges: 送るのは変わった項目だけ", () => {
    const base: NameSide = { displayBadge: "first", proMarkStyle: "iris", verifiedMarkOff: false, earlyMarkOn: null };

    it("何も変えていなければ空（送らない）", () => {
        expect(nameSideChanges(base, { ...base }, { verified: true })).toEqual({});
    });

    it("メダルを外すと displayBadge: null だけ", () => {
        expect(nameSideChanges(base, { ...base, displayBadge: null }, { verified: true })).toEqual({ displayBadge: null });
    });

    it("Pro の印を外すと proMarkStyle: \"none\" だけ", () => {
        expect(nameSideChanges(base, { ...base, proMarkStyle: "none" }, { verified: false })).toEqual({ proMarkStyle: "none" });
    });

    it("公式の印: 外す → true、付ける → false（真偽で送る）", () => {
        expect(nameSideChanges(base, { ...base, verifiedMarkOff: true }, { verified: true })).toEqual({ verifiedMarkOff: true });
        const off = { ...base, verifiedMarkOff: true };
        expect(nameSideChanges(off, { ...off, verifiedMarkOff: false }, { verified: true })).toEqual({ verifiedMarkOff: false });
    });

    it("公式でない人の verifiedMarkOff は送らない", () => {
        expect(nameSideChanges(base, { ...base, verifiedMarkOff: true }, { verified: false })).toEqual({});
    });
});

// 初期メンバーの印（2026-10-28 owner）。規則はサーバーの `showsEarlyMark` と同じ
// （`api-user/src/__tests__/profileBadges.test.ts` の「初期メンバーの印」と同じ場合を並べる）
describe("初期メンバーの印: 設定の下見", () => {
    const EARLY = { earlyUser: { tier: 1, at: AT } };
    const none: NameSide = { displayBadge: null, proMarkStyle: "iris", verifiedMarkOff: false, earlyMarkOn: null };
    const who = (over: Partial<{ pro: boolean; verified: boolean; badges: Record<string, { tier: number; at: string }> }> = {}) =>
        ({ pro: false, verified: false, badges: EARLY, ...over }) as Parameters<typeof earlyMarkShown>[0];

    it("readNameSide: earlyMarkOn は真偽だけ読み、無い・文字は null（既定）", () => {
        expect(readNameSide({ earlyMarkOn: false })?.earlyMarkOn).toBe(false);
        expect(readNameSide({ earlyMarkOn: true })?.earlyMarkOn).toBe(true);
        expect(readNameSide({ earlyMarkOn: "false" })?.earlyMarkOn).toBeNull();
        expect(readNameSide({})?.earlyMarkOn).toBeNull();
    });

    it("資格は初期ユーザー章", () => {
        expect(hasEarlyMemberQualification(EARLY)).toBe(true);
        expect(hasEarlyMemberQualification({ first: { tier: 1, at: AT } })).toBe(false);
        expect(hasEarlyMemberQualification(undefined)).toBe(false);
        expect(earlyMarkShown(who({ badges: {} }), { ...none, earlyMarkOn: true })).toBe(false);
    });

    it("既定: 名前の横に何も出ていなければ付く。公式・Pro・メダルのどれかが出ていれば付かない", () => {
        expect(earlyMarkShown(who(), none)).toBe(true);
        expect(earlyMarkShown(who({ verified: true }), none)).toBe(false);
        expect(earlyMarkShown(who({ pro: true }), none)).toBe(false);
        expect(earlyMarkShown(who(), { ...none, displayBadge: "earlyUser" })).toBe(false);
    });

    it("既定: 外した印・持っていないメダルは「出ていない」", () => {
        expect(earlyMarkShown(who({ verified: true }), { ...none, verifiedMarkOff: true })).toBe(true);
        expect(earlyMarkShown(who({ pro: true }), { ...none, proMarkStyle: "none" })).toBe(true);
        expect(earlyMarkShown(who(), { ...none, displayBadge: "first" })).toBe(true);
    });

    it("本人の設定が既定に勝つ", () => {
        expect(earlyMarkShown(who({ pro: true }), { ...none, earlyMarkOn: true })).toBe(true);
        expect(earlyMarkShown(who(), { ...none, earlyMarkOn: false })).toBe(false);
    });

    it("nameSideChanges: 資格のある人の変わった earlyMarkOn だけ送る", () => {
        expect(nameSideChanges(none, { ...none, earlyMarkOn: false }, { verified: false, early: true })).toEqual({ earlyMarkOn: false });
        expect(nameSideChanges(none, { ...none, earlyMarkOn: false }, { verified: false, early: false })).toEqual({});
        expect(nameSideChanges(none, { ...none }, { verified: false, early: true })).toEqual({});
    });
});

describe("棚の進み具合", () => {
    const progress = readBadgeProgress({
        first: { count: 3, tier: 1, next: null },
        prefectures: { count: 13, tier: 1, next: 30 },
        morning: { count: 25, tier: 1, next: 50 },
        night: { count: 5, tier: 0, next: 10 },
        books: { count: 7, tier: 1, next: 10 },
        countries: { count: "x", tier: 0, next: 3 },   // 形のおかしい行は落とす
        earlyUser: { count: 1, tier: 1, next: null },
    });

    it("形のおかしい行は落とす", () => {
        expect(progress.countries).toBeUndefined();
    });

    it("持っていて上がある → 「あと◯で次」、上がない → 「達成」、まだ → 「あと◯枚」", () => {
        expect(progressText("prefectures", progress.prefectures, true, "ja")).toBe("あと17で次");
        expect(progressText("morning", progress.morning, true, "ja")).toBe("あと25枚で次");
        expect(progressText("books", progress.books, true, "ja")).toBe("あと3冊で次");
        expect(progressText("first", progress.first, true, "ja")).toBe("達成");
        expect(progressText("night", progress.night, false, "ja")).toBe("あと5枚");
        expect(progressText("morning", progress.morning, true, "en")).toBe("25 more photos to next");
        // 進み具合が無い（応答に載っていない）ときは「達成」と言い切らない
        expect(progressText("countries", undefined, true, "ja")).toBe("");
    });

    it("自分の棚: 持っているもの → まだの数えるメダル。Pro のメダル・初期ユーザーはまだなら並べない", () => {
        const badges = {
            first: { tier: 1, at: AT }, prefectures: { tier: 1, at: AT }, morning: { tier: 1, at: AT },
            books: { tier: 1, at: AT }, earlyUser: { tier: 1, at: AT },
        };
        const items = ownShelf(badges, progress, "ja");
        expect(items.filter((i) => i.owned).map((i) => i.key)).toEqual(["first", "prefectures", "morning", "books", "earlyUser"]);
        expect(items.filter((i) => !i.owned).map((i) => i.key)).toEqual(["countries", "seasons", "night", "wish"]);
        expect(items.find((i) => i.key === "prefectures")?.sub).toBe("あと17で次");
        expect(items.find((i) => i.key === "night")?.sub).toBe("あと5枚");
        // 1段だけの章は中身の説明
        expect(items.find((i) => i.key === "earlyUser")?.sub).toBe("2026年10月31日までに登録した");
        expect(items.some((i) => ["supporter", "supporterYear"].includes(i.key))).toBe(false);
    });

    it("人の棚: 持っているものだけ（まだのものは並べない）", () => {
        const items = othersShelf({ morning: { tier: 2, at: AT }, proAutumn2026: { tier: 1, at: AT, year: 2026 } }, "ja");
        expect(items.map((i) => [i.key, i.owned])).toEqual([["morning", true], ["proAutumn2026", true]]);
        expect(items[0].sub).toBe("日の出の前後に50枚");
        expect(othersShelf(undefined, "ja")).toEqual([]);
    });
});

describe("「あと◯」の単位は iOS（BadgeCatalog.kinds の unitJa / unitEn）とそろえる（2026-10-11）", () => {
    // iOS の表（origin/main の `BadgeCatalog.swift`）。続けた年だけ Web は「か月」を残す（iOS は単位なし）
    const IOS: Record<string, [string, string]> = {
        earlyUser: ["", ""], first: ["枚", "photo"], prefectures: ["", ""], countries: ["", ""],
        seasons: ["年", "year"], morning: ["枚", "photo"], night: ["枚", "photo"], books: ["冊", "book"],
        wish: ["", ""], supporter: ["", ""],
    };

    it("数えるメダルは全部、単位の有無を明示し、iOS と同じ", () => {
        for (const [key, [ja, en]] of Object.entries(IOS)) {
            expect([key, UNITS[key as keyof typeof UNITS]]).toEqual([key, { ja, en }]);
        }
        expect(UNITS.supporterYear).toEqual({ ja: "か月", en: "month" });
    });

    it("都道府県・国・地域・行けた場所は数だけ、枚・冊・年は付ける", () => {
        const p = (count: number, next: number) => ({ count, tier: 1, next });
        expect(progressText("prefectures", p(22, 30), true, "ja")).toBe("あと8で次");
        expect(progressText("countries", p(0, 3), false, "ja")).toBe("あと3");
        expect(progressText("wish", p(0, 1), false, "ja")).toBe("あと1");
        expect(progressText("seasons", p(0, 1), false, "ja")).toBe("あと1年");
        expect(progressText("books", p(0, 1), false, "ja")).toBe("あと1冊");
        expect(progressText("night", p(34, 50), true, "ja")).toBe("あと16枚で次");
    });

    it("英語は iOS の言い方（N more X to next / to earn・1 のときは単数）", () => {
        const p = (count: number, next: number) => ({ count, tier: 1, next });
        expect(progressText("night", p(9, 10), false, "en")).toBe("1 more photo to earn");
        expect(progressText("books", p(7, 10), true, "en")).toBe("3 more books to next");
        expect(progressText("prefectures", p(13, 30), true, "en")).toBe("17 more to next");
    });
});
