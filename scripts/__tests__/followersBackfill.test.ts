import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `followers#<uid>` は既にあるフォロー関係には無い（`follow.ts` は今後の
// フォローにしか書かない）。埋め戻しの中身をここで固定する。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseMarker, buildFollowers, mergeFollowers, FOLLOWERS_MAX } = require("../backfill-followers.js");

describe("フォロワーの埋め戻し", () => {
    it("マーカーを分解する", () => {
        expect(parseMarker({ id: "follow#T#F", follow: true, createdAt: "2026-01-01" }))
            .toEqual({ target: "T", follower: "F", createdAt: "2026-01-01" });
    });

    // **`follow#` で始まるだけの行を拾わない。** `follownotify#T#F` は
    // 通知の間引き印で、フォロー関係ではない
    it.each([
        [{ id: "follownotify#T#F", follow: true }],
        [{ id: "follow#T", follow: true }],
        [{ id: "follow#T#F" }],                       // follow: true が無い
        [{ id: "follow##F", follow: true }],          // 空のセグメント
        [{ id: "followstats#T", follow: true }],
    ])("フォロー関係でない行は捨てる: %j", (item) => {
        expect(parseMarker(item)).toBeNull();
    });

    // 並びは `following#` と同じ「新しい順」。`createdAt` を持たない
    // 古いマーカーは末尾へ（空文字は必ず最小）
    it("相手ごとに、新しくフォローされた順で並べる", () => {
        const out = buildFollowers([
            { id: "follow#T#A", follow: true, createdAt: "2026-01-01" },
            { id: "follow#T#B", follow: true, createdAt: "2026-03-01" },
            { id: "follow#T#C", follow: true },
            { id: "follow#U#A", follow: true, createdAt: "2026-02-01" },
        ]);
        expect(out.get("T")).toEqual(["B", "A", "C"]);
        expect(out.get("U")).toEqual(["A"]);
    });

    // **走っている間に入った新しいフォローを消さない。**
    // 全体を Put で置き換えるので、併合しないと取りこぼす
    it("既にある一覧と併合する（新しい方を先に残す）", () => {
        expect(mergeFollowers(["NEW"], ["A", "B"])).toEqual(["NEW", "A", "B"]);
        expect(mergeFollowers(["A"], ["A", "B"]), "重複する").toEqual(["A", "B"]);
        expect(mergeFollowers([], []), "空でも落ちない").toEqual([]);
        expect(mergeFollowers(["A", null as unknown as string, ""], ["B"]), "壊れた行を通す").toEqual(["A", "B"]);
    });

    it("上限で切る", () => {
        const many = Array.from({ length: FOLLOWERS_MAX + 10 }, (_, i) => `u${i}`);
        expect(mergeFollowers([], many)).toHaveLength(FOLLOWERS_MAX);
    });

    // **サーバー側の上限と同じでなければならない。** 大きいと 400KB の
    // 項目上限に近づき、小さいと埋め戻した直後にサーバーが切り詰めて食い違う
    it("上限はサーバー側（follow.ts の FOLLOWING_MAX）と一致する", () => {
        const src = readFileSync(join(__dirname, "..", "..", "api-user", "src", "follow.ts"), "utf8");
        const m = /const FOLLOWING_MAX = (\d+);/.exec(src);
        expect(m, "サーバー側の上限を読み取れない").not.toBeNull();
        expect(Number(m![1])).toBe(FOLLOWERS_MAX);
    });

    // 行の綴りが `follow.ts` と揃っていること（ずれると誰も読まない行を作る）
    it("書き込む行のキーは followers#<uid>", () => {
        const src = readFileSync(join(__dirname, "..", "backfill-followers.js"), "utf8");
        expect(src).toContain("`followers#${target}`");
        const server = readFileSync(join(__dirname, "..", "..", "api-user", "src", "follow.ts"), "utf8");
        expect(server).toContain("`followers#${uid}`");
    });
});
