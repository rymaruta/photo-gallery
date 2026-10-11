import { describe, it, expect } from "vitest";
import {
    readNameSide, nameSideChanges, readBadgeProgress, progressText, ownShelf, othersShelf,
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
    const base: NameSide = { displayBadge: "first", proMarkStyle: "iris", verifiedMarkOff: false };

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
        expect(progressText("morning", progress.morning, true, "en")).toBe("25 photos to next");
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
