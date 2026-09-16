import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { planPurge, maskEmail, TARGET_STATUS, DEFAULT_OLDER_THAN_DAYS } = require("../purge-unconfirmed-users.js") as {
    planPurge: (a: { users: unknown[]; olderThanDays?: number; now?: number }) => {
        deletable: { username: string }[]; skipped: { username: string; reason: string }[];
    };
    maskEmail: (e: unknown) => string;
    TARGET_STATUS: string;
    DEFAULT_OLDER_THAN_DAYS: number;
};

/**
 * **本番の利用者を消す道具。取り消せない。**
 *
 * 間違える向きは2つあって、重さが全然違う:
 *   - 消し損ねる … もう一度流せばよい
 *   - **消しすぎる … 戻せない**
 *
 * なので判定は「消してよいと確信できたものだけ通す」形にしてある。
 * ここではその**弾く側**を1つずつ見る。
 */
const DAY = 86400000;
const NOW = Date.parse("2026-09-16T12:00:00Z");
const old = (days: number) => new Date(NOW - days * DAY);

const u = (over: Record<string, unknown> = {}) => ({
    username: "u1", status: "UNCONFIRMED", createdAt: old(30), email: "a@example.com", hasProfile: false, ...over,
});

describe("誰を消すか", () => {
    it("対象は UNCONFIRMED だけ・既定は7日", () => {
        expect(TARGET_STATUS).toBe("UNCONFIRMED");
        expect(DEFAULT_OLDER_THAN_DAYS).toBe(7);
    });

    it("十分に古い UNCONFIRMED は消す", () => {
        const p = planPurge({ users: [u()], now: NOW });
        expect(p.deletable.map((x) => x.username)).toEqual(["u1"]);
    });

    // **いちばん怖い取り違え。** `FORCE_CHANGE_PASSWORD` は管理者が作ったばかりの
    // 正規の利用者で、「まだログインしていない」だけ。巻き込むと当人が消える
    it("UNCONFIRMED 以外は1つも消さない", () => {
        const others = ["CONFIRMED", "FORCE_CHANGE_PASSWORD", "RESET_REQUIRED", "ARCHIVED", "COMPROMISED", "EXTERNAL_PROVIDER", "UNKNOWN"];
        const p = planPurge({ users: others.map((s, i) => u({ username: `x${i}`, status: s })), now: NOW });
        expect(p.deletable).toEqual([]);
        expect(p.skipped).toHaveLength(others.length);
    });

    it("状態が無い（不明）も消さない", () => {
        const p = planPurge({ users: [u({ status: undefined })], now: NOW });
        expect(p.deletable).toEqual([]);
        expect(p.skipped[0].reason).toContain("不明");
    });

    // **いま登録してコードを打とうとしている人を消さない。**
    // 確認コードの既定の寿命は24時間
    it("新しすぎる人は消さない（境界のちょうどは消す）", () => {
        expect(planPurge({ users: [u({ createdAt: old(6.9) })], now: NOW }).deletable).toEqual([]);
        expect(planPurge({ users: [u({ createdAt: old(7) })], now: NOW }).deletable).toHaveLength(1);
        // 何日で切るかは変えられる
        expect(planPurge({ users: [u({ createdAt: old(6.9) })], olderThanDays: 1, now: NOW }).deletable).toHaveLength(1);
        expect(planPurge({ users: [u({ createdAt: old(0.5) })], olderThanDays: 1, now: NOW }).deletable).toEqual([]);
    });

    it("0日にすれば「たった今」でも対象になる（承知で指定したとき）", () => {
        expect(planPurge({ users: [u({ createdAt: new Date(NOW) })], olderThanDays: 0, now: NOW }).deletable).toHaveLength(1);
    });

    // **前提が外れていたら止まる。** UNCONFIRMED は行を持たないはずだが、
    // 持っていたらこちらの理解が間違っている＝消してから気づいても戻せない
    it("プロフィール行があれば消さない", () => {
        const p = planPurge({ users: [u({ hasProfile: true })], now: NOW });
        expect(p.deletable).toEqual([]);
        expect(p.skipped[0].reason).toContain("プロフィール行");
    });

    // 読めないものを「古い」と読むと、消す方向に倒れる
    it("作成日時を読めなければ消さない", () => {
        for (const bad of [undefined, null, "", "not-a-date", NaN]) {
            const p = planPurge({ users: [u({ createdAt: bad })], now: NOW });
            expect(p.deletable, String(bad)).toEqual([]);
            expect(p.skipped[0].reason).toContain("作成日時");
        }
    });

    it("文字列の日時も読む（SDK が Date を返さない経路のため）", () => {
        expect(planPurge({ users: [u({ createdAt: "2026-01-01T00:00:00Z" })], now: NOW }).deletable).toHaveLength(1);
    });

    it("空でも落ちない", () => {
        expect(planPurge({ users: [], now: NOW })).toEqual({ deletable: [], skipped: [] });
        expect(planPurge({ users: undefined as unknown as unknown[], now: NOW }).deletable).toEqual([]);
    });

    it("混ざっていても、消すのは条件を全部満たしたものだけ", () => {
        const p = planPurge({
            users: [
                u({ username: "ok" }),
                u({ username: "confirmed", status: "CONFIRMED" }),
                u({ username: "fresh", createdAt: old(1) }),
                u({ username: "hasrow", hasProfile: true }),
                u({ username: "nodate", createdAt: undefined }),
            ],
            now: NOW,
        });
        expect(p.deletable.map((x) => x.username)).toEqual(["ok"]);
        expect(p.skipped).toHaveLength(4);
    });
});

describe("ログに生のメールを残さない", () => {
    it("先頭1文字とドメインだけにする", () => {
        expect(maskEmail("tabibito@example.com")).toBe("t***@example.com");
    });
    it("壊れた値でも落ちない", () => {
        expect(maskEmail(undefined)).toBe("(なし)");
        expect(maskEmail("")).toBe("(なし)");
        expect(maskEmail("@example.com")).toBe("***");
        expect(maskEmail("no-at-sign")).toBe("***");
    });
});
