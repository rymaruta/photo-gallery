import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import * as badges from "../../api-user/src/badges";
import * as badgeKeys from "../../api-user/src/badgeKeys";
import { isRestrictedRow } from "../../api-user/src/sanitize";

// メダルを公開の写真だけで数えるようにしたあと、絞った写真で付いた段を1回だけ数え直す計画
// （`backfill-badges.js --public-only`・2026-10-18・journey.photo-ios #296）

const require = createRequire(import.meta.url);
type Lowered = { key: string; from: number; to: number };
const { planPublicOnly } = require("../backfill-badges.js") as {
    planPublicOnly: (lib: unknown, row: Record<string, unknown>, photos: Record<string, unknown>[], wishKeys: string[]) =>
        { write: boolean; badges: Record<string, { tier: number; at: string; year?: number }>; lowered: Lowered[]; rev: number };
};
const lib = { ...badges, ...badgeKeys, isRestrictedRow };

const OLD = "2026-10-01T00:00:00.000Z";
let n = 0;
const photo = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: `p${++n}`, src: `photos/u1/p${n}.jpg`, ...over });
/** 都道府県の段を上げるのに十分な県（`prefectureOfText` が読める名前） */
const PREFS = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県"];

describe("backfill-badges --public-only", () => {
    it("絞った写真の無い人は触らない（段が数え直しより高くても、公開の写真を消しただけかもしれない）", () => {
        const row = { userId: "u1", rev: 2, badges: { first: { tier: 1, at: OLD }, prefectures: { tier: 1, at: OLD } } };
        const plan = planPublicOnly(lib, row, [photo({ location: "京都府" })], []);
        expect(plan.write).toBe(false);
        expect(plan.lowered).toEqual([]);
    });

    it("絞った写真で付いた段だけ下げる。at は流した時刻、0 段は消す。初期ユーザー・Pro のメダルは触らない", () => {
        const restricted = PREFS.map((l) => photo({ location: l, audience: "followers" }));
        const row = {
            userId: "u1", rev: 5, displayBadge: "prefectures",
            badges: {
                first: { tier: 1, at: OLD },
                prefectures: { tier: 1, at: OLD },
                earlyUser: { tier: 1, at: OLD },
                supporter: { tier: 1, at: OLD },
                proAutumn2026: { tier: 1, at: OLD },
            },
        };
        // 公開の写真は1枚（最初の一枚は残る・都道府県は 1 県で段に届かない）
        const plan = planPublicOnly(lib, row, [...restricted, photo({ location: "京都府" })], []);
        expect(plan.write).toBe(true);
        expect(plan.lowered).toEqual([{ key: "prefectures", from: 1, to: 0 }]);
        expect(plan.badges.prefectures).toBeUndefined();
        expect(plan.badges.first).toEqual({ tier: 1, at: OLD });
        expect(plan.badges.earlyUser).toEqual({ tier: 1, at: OLD });
        expect(plan.badges.supporter).toEqual({ tier: 1, at: OLD });
        expect(plan.badges.proAutumn2026).toEqual({ tier: 1, at: OLD, year: 2026 });
        expect(plan.rev).toBe(5);
    });

    it("全部が絞った写真なら「最初の一枚」も下がる", () => {
        const hidden = photo({ location: "沖縄県", audience: "closeFriends" });
        const only = planPublicOnly(lib, { userId: "u2", badges: { first: { tier: 1, at: OLD } } }, [hidden], []);
        expect(only.lowered).toEqual([{ key: "first", from: 1, to: 0 }]);
        expect(only.badges.first).toBeUndefined();
    });

    // 2026-10-18 見直し: 流した日にすると「その日に段が下がった人＝絞った写真を持つ人」と分かる
    it("段の途中まで下げたときの at は、公開の写真だけでその段に届いた投稿の日時（流した日にしない）", () => {
        const row = { userId: "u1", badges: { first: { tier: 1, at: OLD }, prefectures: { tier: 2, at: OLD } } };
        // 公開で10県（10枚目の投稿で銅に届く）。投稿日時はばらばら（並べ替えて数える）
        const pub = PREFS.map((l, i) => photo({ location: l, createdAt: `2026-0${(i % 9) + 1}-15T00:00:00.000Z` }));
        pub[9] = { ...pub[9], createdAt: "2026-09-30T12:00:00.000Z" };
        const hidden = photo({ location: "沖縄県", audience: "closeFriends", createdAt: "2026-10-05T00:00:00.000Z" });
        const plan = planPublicOnly(lib, row, [...pub, hidden], []);
        expect(plan.lowered).toEqual([{ key: "prefectures", from: 2, to: 1 }]);
        // 10県目（いちばん遅い公開の投稿）の日時。絞った写真の日でも、元の日でもない
        expect(plan.badges.prefectures).toEqual({ tier: 1, at: "2026-09-30T12:00:00.000Z" });
        expect(plan.badges.first).toEqual({ tier: 1, at: OLD });

        // 人によって日が違う（全員が同じ日にならない）
        const pub2 = PREFS.map((l) => photo({ location: l, createdAt: "2025-05-01T00:00:00.000Z" }));
        const plan2 = planPublicOnly(lib, row, [...pub2, hidden], []);
        expect(plan2.badges.prefectures?.at).toBe("2025-05-01T00:00:00.000Z");
    });

    it("投稿日時が分からなければ、保存されていた元の at を残す", () => {
        const row = { userId: "u1", badges: { prefectures: { tier: 2, at: OLD } } };
        const pub = PREFS.map((l) => photo({ location: l }));   // createdAt なし
        const plan = planPublicOnly(lib, row, [...pub, photo({ location: "沖縄県", audience: "followers" })], []);
        expect(plan.badges.prefectures).toEqual({ tier: 1, at: OLD });
    });

    it("絞った下書き・ストーリーだけの人は対象にしない（もともと数えていない）", () => {
        const row = { userId: "u1", badges: { first: { tier: 1, at: OLD } } };
        const plan = planPublicOnly(lib, row, [
            photo({ audience: "followers", published: false }),
            photo({ audience: "followers", story: true }),
        ], []);
        expect(plan.write).toBe(false);
    });

    it("上げることはしない（上がる分はふだんの数え直しが拾う）", () => {
        const row = { userId: "u1", badges: {} };
        const plan = planPublicOnly(lib, row, [photo(), photo({ audience: "followers" })], []);
        expect(plan.write).toBe(false);
        expect(plan.badges.first).toBeUndefined();
    });
});
