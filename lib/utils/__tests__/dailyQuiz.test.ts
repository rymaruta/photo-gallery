import { describe, it, expect } from "vitest";
import { buildDailyQuiz, dayNumber, datesFrom, fnv1a, mix32, quizScore, QUIZ_EPOCH, QUIZ_NO_REPEAT_DAYS, type QuizSpot } from "../dailyQuiz";

const img = (id: string) => ({ url: `https://example.com/${id}.jpg`, author: "a", license: "CC BY-SA 4.0", pageUrl: "https://example.com" });
const spot = (n: number, region: QuizSpot["region"], name = `場所${n}`): QuizSpot => {
    const id = `sp_${n.toString(16).padStart(12, "0")}`;
    return { spotId: id, slug: `s${n}`, name, region, image: img(id) };
};

const YAMAGATA = { prefecture: "山形県" };
const KYOTO = { prefecture: "京都府" };
const FRANCE = { country: "フランス" };

describe("今日の一問の出題", () => {
    const pool = [
        ...[1, 2, 3, 4, 5].map((n) => spot(n, YAMAGATA)),
        ...[6, 7, 8, 9].map((n) => spot(n, KYOTO)),
        ...[10, 11].map((n) => spot(n, FRANCE)),
    ];

    it("同じ日は同じ問題・候補の並びに左右されない", () => {
        const a = buildDailyQuiz(pool, "2026-10-01");
        const b = buildDailyQuiz([...pool].reverse(), "2026-10-01");
        expect(a).not.toBeNull();
        expect(b).toEqual(a);
    });

    it("起点の日の答えは点数がいちばん高い候補", () => {
        const q = buildDailyQuiz(pool, QUIZ_EPOCH)!;
        const top = [...pool].sort((a, b) => quizScore(dayNumber(QUIZ_EPOCH)!, b.spotId) - quizScore(dayNumber(QUIZ_EPOCH)!, a.spotId))[0];
        expect(q.answer).toBe(top.spotId);
    });

    it("直近の答えは繰り返さない（候補が少なければ候補数−1日）", () => {
        const days = datesFrom(QUIZ_EPOCH, 40);
        const answers = days.map((d) => buildDailyQuiz(pool, d)!.answer);
        const window = Math.min(QUIZ_NO_REPEAT_DAYS, pool.length - 1);
        for (let i = 0; i < answers.length; i++) {
            const prev = answers.slice(Math.max(0, i - window), i);
            expect(prev, days[i]).not.toContain(answers[i]);
        }
        // 大きな候補でも30日は重ならない
        const big = Array.from({ length: 200 }, (_, n) => spot(n + 1, YAMAGATA));
        const a2 = datesFrom("2026-10-01", 61).map((d) => buildDailyQuiz(big, d)!.answer);
        for (let i = 0; i < a2.length; i++) expect(a2.slice(Math.max(0, i - 30), i)).not.toContain(a2[i]);
    });

    it("🔴 候補を1件足しても、ほとんどの日の答えは変わらない（公開した回のデプロイで問題が差し替わらない）", () => {
        const big = Array.from({ length: 300 }, (_, n) => spot(n + 1, YAMAGATA));
        const days = datesFrom("2026-10-01", 61);
        const before = days.map((d) => buildDailyQuiz(big, d)!.answer);
        const after = days.map((d) => buildDailyQuiz([...big, spot(999, YAMAGATA)], d)!.answer);
        const changed = before.filter((a, i) => a !== after[i]).length;
        expect(changed).toBeLessThan(10);
    });

    it("選択肢は4つ・重複なし・正解を含み・写真は正解のもの", () => {
        for (const ymd of datesFrom("2026-10-01", 30)) {
            const q = buildDailyQuiz(pool, ymd)!;
            expect(q.choices).toHaveLength(4);
            expect(new Set(q.choices.map((c) => c.spotId)).size).toBe(4);
            const answer = pool.find((s) => s.spotId === q.answer)!;
            expect(q.choices.map((c) => c.spotId)).toContain(q.answer);
            expect(q.photo).toEqual(answer.image);
            expect(q.date).toBe(ymd);
        }
    });

    it("ほかの3つは同じ県から取る（足りれば）", () => {
        for (const ymd of datesFrom("2026-10-01", 30)) {
            const q = buildDailyQuiz(pool, ymd)!;
            const answer = pool.find((s) => s.spotId === q.answer)!;
            if (answer.region.prefecture === "山形県") {
                expect(q.choices.every((c) => c.region.prefecture === "山形県"), ymd).toBe(true);
            }
            if (answer.region.prefecture === "京都府") {
                expect(q.choices.every((c) => c.region.prefecture === "京都府"), ymd).toBe(true);
            }
        }
    });

    it("県で足りなければ同じ国から補う（海外の2件は日本の行で埋めない前に国を見る）", () => {
        const p = [spot(1, { country: "フランス", prefecture: "A" }), spot(2, { country: "フランス", prefecture: "B" }),
            spot(3, { country: "フランス", prefecture: "C" }), spot(4, { country: "フランス", prefecture: "D" }),
            ...[5, 6, 7, 8, 9, 10].map((n) => spot(n, YAMAGATA))];
        for (const ymd of datesFrom("2026-10-01", 20)) {
            const q = buildDailyQuiz(p, ymd)!;
            const answer = p.find((s) => s.spotId === q.answer)!;
            if (answer.region.country === "フランス") {
                expect(q.choices.every((c) => c.region.country === "フランス"), ymd).toBe(true);
            }
        }
    });

    it("正解と同じ名前・同じ名前どうしは並べない", () => {
        const p = [spot(1, YAMAGATA, "同名"), spot(2, YAMAGATA, "同名"), spot(3, YAMAGATA, "別A"), spot(4, YAMAGATA, "別B"),
            spot(5, YAMAGATA, "別C"), spot(6, YAMAGATA, "別B")];
        for (const ymd of datesFrom("2026-10-01", 20)) {
            const q = buildDailyQuiz(p, ymd);
            if (!q) continue;
            const names = q.choices.map((c) => c.name);
            expect(new Set(names).size, ymd).toBe(names.length);
        }
    });

    it("候補が4件に満たない・名前違いで3つ揃わない・日付が不正なら出さない", () => {
        expect(buildDailyQuiz(pool.slice(0, 3), "2026-10-01")).toBeNull();
        expect(buildDailyQuiz([spot(1, YAMAGATA, "x"), spot(2, YAMAGATA, "x"), spot(3, YAMAGATA, "x"), spot(4, YAMAGATA, "y")], "2026-10-01")).toBeNull();
        expect(buildDailyQuiz(pool, "2026-02-30")).toBeNull();
        expect(buildDailyQuiz(pool, "2026-10-1")).toBeNull();
    });

    it("写真の無い行は数えない", () => {
        const noImg = { ...spot(20, YAMAGATA), image: { ...img("x"), url: "" } };
        expect(buildDailyQuiz([...pool.slice(0, 3), noImg], "2026-10-01")).toBeNull();
    });

    it("同じ ID が2行あっても、どちらを残すかは並びに左右されない", () => {
        const a = pool.slice(0, 6);
        const twin = a.map((s) => ({ ...s, image: { ...s.image, url: s.image.url.replace(".jpg", "-b.jpg") } }));
        for (const ymd of datesFrom("2026-10-01", 10)) {
            expect(buildDailyQuiz([...twin, ...a], ymd), ymd).toEqual(buildDailyQuiz([...a, ...twin], ymd));
        }
    });
});

describe("出題の道具", () => {
    it("dayNumber は紀元からの日数", () => {
        expect(dayNumber("1970-01-01")).toBe(0);
        expect(dayNumber("1970-01-02")).toBe(1);
        expect(dayNumber("2024-02-29")).not.toBeNull();
        expect(dayNumber("2025-02-29")).toBeNull();
        expect(dayNumber("0050-01-01")).toBeNull();
    });

    it("datesFrom は月・年をまたぐ", () => {
        expect(datesFrom("2026-12-30", 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
        expect(datesFrom("bad", 3)).toEqual([]);
        expect(datesFrom("2026-01-01", 0)).toEqual([]);
    });

    it("fnv1a は既知の値", () => {
        expect(fnv1a("")).toBe(0x811c9dc5);
        expect(fnv1a("a")).toBe(0xe40c292c);
    });

    it("mix32 は既知の値（アプリも同じ式）", () => {
        expect(mix32(0)).toBe(0);
        expect(mix32(1)).toBe(0x514e28b7);
    });
});
