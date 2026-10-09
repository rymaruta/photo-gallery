import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
    BADGE_KEYS, BADGE_MAX_TIER, BADGE_NAMES, badgeImage, badgeLabel, badgeDescription, sanitizeBadgeMap, ownedBadges,
    proMarkImage,
} from "../badges";
import { BADGE_KEYS as SERVER_KEYS, MAX_TIER as SERVER_MAX, BADGE_NAME_JA } from "../../../api-user/src/badgeKeys";
import { BADGE_THRESHOLDS } from "../../../api-user/src/badges";
import { sanitizeProfile } from "../../utils/profileShape";

const AT = "2026-10-01T00:00:00.000Z";
const PUBLIC = join(__dirname, "..", "..", "..", "public");

describe("メダルの表（画面）", () => {
    it("鍵・段の上限・日本語の名前がサーバーと同じ", () => {
        expect([...BADGE_KEYS]).toEqual([...SERVER_KEYS]);
        expect(BADGE_MAX_TIER).toEqual(SERVER_MAX);
        for (const k of BADGE_KEYS) expect(BADGE_NAMES[k].ja, k).toBe(BADGE_NAME_JA[k]);
    });

    it("説明の数がサーバーの段の線と同じ", () => {
        for (const [key, lines] of Object.entries(BADGE_THRESHOLDS)) {
            if (key === "first") continue;
            lines.forEach((n, i) => {
                expect(badgeDescription(key as never, i + 1, "ja"), `${key} ${i + 1}`).toContain(String(n));
            });
        }
    });

    it("全部の鍵・段の絵が public/badges にある（大・小）", () => {
        const missing: string[] = [];
        for (const key of BADGE_KEYS) {
            for (let tier = 1; tier <= BADGE_MAX_TIER[key]; tier++) {
                for (const small of [true, false]) {
                    const p = badgeImage(key, tier, small);
                    if (!existsSync(join(PUBLIC, p))) missing.push(p);
                }
            }
        }
        for (const style of ["iris", "plate"] as const) {
            for (const size of [12, 20]) {
                const p = proMarkImage(style, size);
                if (!existsSync(join(PUBLIC, p))) missing.push(p);
            }
        }
        expect(missing).toEqual([]);
    });

    it("段つきの名前（1段だけのメダルは段を書かない）", () => {
        expect(badgeLabel("prefectures", 3, "ja")).toBe("都道府県（白金）");
        expect(badgeLabel("prefectures", 1, "en")).toBe("Prefectures · Bronze");
        expect(badgeLabel("first", 1, "ja")).toBe("はじめての一枚");
        expect(badgeLabel("earlyUser", 1, "en")).toBe("Early member");
    });

    it("応答の badges は描いてよい形だけ残し、表の順に並べる", () => {
        const map = sanitizeBadgeMap({
            wish: { tier: 1, at: AT }, first: { tier: 1, at: AT }, bogus: { tier: 1, at: AT },
            morning: { tier: 9, at: AT }, night: { tier: 1 },
        });
        expect(map).toEqual({ wish: { tier: 1, at: AT }, first: { tier: 1, at: AT } });
        expect(ownedBadges(map).map((b) => b.key)).toEqual(["first", "wish"]);
        expect(sanitizeBadgeMap("x")).toBeUndefined();
    });
});

describe("sanitizeProfile: メダルと Pro", () => {
    type P = { badges?: unknown; displayBadge?: unknown; pro?: unknown; proMarkStyle?: unknown };

    it("持っているメダルの displayBadge だけ残す", () => {
        const p = sanitizeProfile<P>({ userId: "u1", badges: { first: { tier: 1, at: AT } }, displayBadge: "first" }, "t")!;
        expect(p.displayBadge).toBe("first");
        const q = sanitizeProfile<P>({ userId: "u1", badges: { first: { tier: 1, at: AT } }, displayBadge: "wish" }, "t")!;
        expect(q.displayBadge).toBeUndefined();
    });

    it("壊れた形は落とす（pro は true のときだけ・proMarkStyle は既定 iris）", () => {
        const p = sanitizeProfile<P>({ userId: "u1", badges: [1, 2], displayBadge: 3, pro: "true", proMarkStyle: "gold" }, "t")!;
        expect(p.badges).toBeUndefined();
        expect(p.displayBadge).toBeUndefined();
        expect(p.pro).toBe(false);
        expect(p.proMarkStyle).toBe("iris");
        const q = sanitizeProfile<P>({ userId: "u1", pro: true, proMarkStyle: "plate" }, "t")!;
        expect(q.pro).toBe(true);
        expect(q.proMarkStyle).toBe("plate");
    });
});
