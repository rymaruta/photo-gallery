import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `followers#<uid>` は既にあるフォロー関係には無い（`follow.ts` は今後の
// フォローにしか書かない）。埋め戻しの中身をここで固定する。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseMarker, buildFollowers, mergeFollowers, FOLLOWERS_MAX, SKIP_REASONS } = require("../backfill-followers.js");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("フォロワーの埋め戻し", () => {
    it("マーカーを分解する", () => {
        expect(parseMarker({ id: `follow#${A}#${B}`, follow: true, createdAt: "2026-01-01" }))
            .toEqual({ target: A, follower: B, createdAt: "2026-01-01" });
    });

    // **`follow#` で始まるだけの行を拾わない。** `follownotify#T#F` は
    // 通知の間引き印で、フォロー関係ではない
    it.each([
        [{ id: `follownotify#${A}#${B}`, follow: true }],
        [{ id: `follow#${A}`, follow: true }],
        [{ id: `follow#${A}#${B}` }],                  // follow: true が無い
        [{ id: `follow##${B}`, follow: true }],        // 空のセグメント
        [{ id: `followstats#${A}`, follow: true }],
        // **でたらめな ID を拾わない。** `isUserId` を入れる前は形も存在も
        // 見ていなかったので、そういうマーカーが残っている可能性がある。
        // 拾うと誰も読まない行ができ、空のプロフィールへのリンクが並ぶ
        [{ id: "follow#not-a-uuid#" + B, follow: true }],
        [{ id: `follow#${A}#not-a-uuid`, follow: true }],
    ])("フォロー関係でない行は捨てる: %j", (item) => {
        expect(parseMarker(item).skip, "理由を返していない").toBeTruthy();
        expect(parseMarker(item).target).toBeUndefined();
    });

    // **捨てた理由を数える。** 本番のドライランで「マーカー 2 件 / 対象 0 人」
    // が出たとき、理由を出していなかったので**正しくゴミを弾いたのか、
    // 本物のフォローを取りこぼしたのかが分からなかった**
    it("捨てた件数を理由ごとに数える", () => {
        const out = buildFollowers([
            { id: `follow#${A}#${B}`, follow: true },
            { id: `follow#not-a-uuid#${B}`, follow: true },
            { id: `follow#${A}`, follow: true },
            { id: `follow#${A}#${B}` },
        ]);
        expect(out.size, "生きているフォロー関係まで捨てている").toBe(1);
        expect(out.skipped.get(SKIP_REASONS.NOT_USER_ID)).toBe(1);
        expect(out.skipped.get(SKIP_REASONS.SHAPE)).toBe(1);
        expect(out.skipped.get(SKIP_REASONS.NOT_MARKER)).toBe(1);
    });

    it("全部きれいなら、捨てた理由は空", () => {
        const out = buildFollowers([{ id: `follow#${A}#${B}`, follow: true }]);
        expect(out.skipped.size).toBe(0);
    });

    // 並びは `following#` と同じ「新しい順」。`createdAt` を持たない
    // 古いマーカーは末尾へ（空文字は必ず最小）
    it("相手ごとに、新しくフォローされた順で並べる", () => {
        const C = "33333333-3333-4333-8333-333333333333";
        const T = "44444444-4444-4444-8444-444444444444";
        const U = "55555555-5555-4555-8555-555555555555";
        const out = buildFollowers([
            { id: `follow#${T}#${A}`, follow: true, createdAt: "2026-01-01" },
            { id: `follow#${T}#${B}`, follow: true, createdAt: "2026-03-01" },
            { id: `follow#${T}#${C}`, follow: true },
            { id: `follow#${U}#${A}`, follow: true, createdAt: "2026-02-01" },
        ]);
        expect(out.get(T)).toEqual([B, A, C]);
        expect(out.get(U)).toEqual([A]);
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
