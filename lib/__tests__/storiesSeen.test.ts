import { describe, it, expect, beforeEach } from "vitest";
import {
    loadSeenStoryIds, markStorySeen, clearSeenStories,
    setSeenStoriesUser, removeSeenStoriesUserData, isSeenStoriesKey,
} from "../stories";

/**
 * ストーリーの既読記録。
 *
 * owner の報告:「ログインし直すと一回見たストーリーなのに新着みたいになる」。
 *
 * **原因は鍵が利用者ごとに分かれていなかったこと。** 共有キー1本だったので、
 * 同じ端末で別の人がログインすると前の人の既読リングが付いて見える
 * ——それを避けるために**ログアウトのたびに全部消していた**。結果、
 * 同じ人が入り直しただけで全部が新着に戻っていた。
 *
 * 鍵を分ければ両方満たせる（`useFavorites` が同じ理由で先に同じ形にしてある）。
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
    localStorage.clear();
    setSeenStoriesUser(null);
});

describe("ストーリーの既読（利用者ごと）", () => {
    // 🔴 報告そのもの
    it("ログインし直しても、一度見たストーリーは既読のまま", () => {
        setSeenStoriesUser(A);
        markStorySeen("s1");
        // ログアウト（= 未ログインへ）。ここで全部消していたのが原因
        setSeenStoriesUser(null);
        clearSeenStories();
        // 同じ人がログインし直す
        setSeenStoriesUser(A);
        expect([...loadSeenStoryIds()], "入り直しただけで新着に戻っている").toEqual(["s1"]);
    });

    // **こちらも壊さない**（全部消していた元の目的）
    it("別の人には、前の人の既読が見えない", () => {
        setSeenStoriesUser(A);
        markStorySeen("s1");
        setSeenStoriesUser(B);
        expect([...loadSeenStoryIds()], "前の人の既読リングが付いて見える").toEqual([]);
        markStorySeen("s2");
        setSeenStoriesUser(A);
        expect([...loadSeenStoryIds()], "別の人の既読が混ざっている").toEqual(["s1"]);
    });

    it("未ログインのぶんは共有キー。ログイン中のぶんとは混ざらない", () => {
        setSeenStoriesUser(null);
        markStorySeen("anon");
        setSeenStoriesUser(A);
        expect([...loadSeenStoryIds()]).toEqual([]);
        markStorySeen("s1");
        setSeenStoriesUser(null);
        expect([...loadSeenStoryIds()]).toEqual(["anon"]);
    });

    // **ログイン中のぶんは消さない**（これを消していたのが報告の原因）
    it("共有キーの掃除で、ログイン中の既読を巻き添えにしない", () => {
        setSeenStoriesUser(A);
        markStorySeen("s1");
        setSeenStoriesUser(null);
        markStorySeen("anon");
        clearSeenStories();
        expect([...loadSeenStoryIds()], "共有キーが消えていない").toEqual([]);
        setSeenStoriesUser(A);
        expect([...loadSeenStoryIds()], "ログイン中の既読まで消している").toEqual(["s1"]);
    });

    // 同じ userId では二度とログインできないので、読めない鍵付きデータを残さない
    it("退会した人のぶんは消す", () => {
        setSeenStoriesUser(A);
        markStorySeen("s1");
        setSeenStoriesUser(B);
        markStorySeen("s2");
        removeSeenStoriesUserData(A);
        setSeenStoriesUser(A);
        expect([...loadSeenStoryIds()], "退会した人の記録が残っている").toEqual([]);
        setSeenStoriesUser(B);
        expect([...loadSeenStoryIds()], "関係ない人まで消している").toEqual(["s2"]);
    });

    // 25時間より古い記録は掃除する（ストーリー自体が24時間で消える）
    it("古い記録は読まない", () => {
        setSeenStoriesUser(A);
        const old = Date.now() - 26 * 60 * 60 * 1000;
        localStorage.setItem(`jp_seen_stories:${A}`, JSON.stringify({ old: old, fresh: Date.now() }));
        expect([...loadSeenStoryIds()]).toEqual(["fresh"]);
    });
});

/**
 * 別タブの変更を拾う判定。**鍵が利用者ごとになったので、綴りの決め打ちでは
 * 合わない**（合わないと、片方のタブで全部見てももう片方のリングが
 * 未読のまま残る）。
 */
describe("isSeenStoriesKey", () => {
    it("いまのアカウントの鍵に一致する", () => {
        setSeenStoriesUser(A);
        expect(isSeenStoriesKey(`jp_seen_stories:${A}`)).toBe(true);
        expect(isSeenStoriesKey(`jp_seen_stories:${B}`), "別の人の変更で読み直している").toBe(false);
        expect(isSeenStoriesKey("jp_seen_stories"), "共有キーの変更で読み直している").toBe(false);
        expect(isSeenStoriesKey("photo-gallery-favorites")).toBe(false);
    });

    it("未ログインなら共有キー", () => {
        setSeenStoriesUser(null);
        expect(isSeenStoriesKey("jp_seen_stories")).toBe(true);
        expect(isSeenStoriesKey(`jp_seen_stories:${A}`)).toBe(false);
    });

    // `key === null` は「まとめて消した」。どの鍵か分からないので読み直す
    it("まとめて消されたときは読み直す", () => {
        setSeenStoriesUser(A);
        expect(isSeenStoriesKey(null)).toBe(true);
    });
});
