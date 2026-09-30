import { describe, it, expect } from "vitest";
import { buildDailyQuiz, parseDailyQuiz, regionLine, dayNumber, datesFrom, fnv1a, mix32, quizScore, QUIZ_EPOCH, QUIZ_NO_REPEAT_DAYS, type QuizSpot } from "../dailyQuiz";

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

    it("🔴 候補を1件足しても減らしても、ほとんどの日の答えは変わらない（公開した回のデプロイで問題が差し替わらない）", () => {
        const big = Array.from({ length: 300 }, (_, n) => spot(n + 1, YAMAGATA));
        const days = datesFrom("2026-10-01", 61);
        const answers = (p: QuizSpot[]) => days.map((d) => buildDailyQuiz(p, d)!.answer);
        const before = answers(big);
        const changed = (after: string[]) => before.filter((a, i) => a !== after[i]).length;
        expect(changed(answers([...big, spot(999, YAMAGATA)]))).toBeLessThan(10);
        expect(changed(answers(big.filter((s) => s.spotId !== before[10])))).toBeLessThan(10);
    });

    it("答えの値を固定する（控えの有無・聞く順で変わらない）", () => {
        const p50 = Array.from({ length: 50 }, (_, n) => spot(n + 1, n % 2 ? YAMAGATA : KYOTO));
        const expected: [string, string][] = [
            ["2026-08-15", "sp_000000000015"], ["2026-09-01", "sp_00000000001c"], ["2026-09-02", "sp_000000000007"],
            ["2026-10-01", "sp_000000000020"], ["2026-12-31", "sp_00000000001d"], ["2027-06-15", "sp_00000000000e"],
        ];
        // 遠い日を先に聞いて控えを伸ばしてから、手前の日を聞く
        for (const [d, id] of [...expected].reverse()) expect(buildDailyQuiz(p50, d)!.answer, d).toBe(id);
        // 別の顔ぶれを挟んで控えを捨てさせても同じ
        buildDailyQuiz(pool, "2027-06-15");
        for (const [d, id] of expected) expect(buildDailyQuiz(p50, d)!.answer, d).toBe(id);
    });

    it("除外は30日ちょうど（31件なら31日で全部が1回ずつ出る）", () => {
        expect(QUIZ_NO_REPEAT_DAYS).toBe(30);
        const p31 = Array.from({ length: 31 }, (_, n) => spot(n + 1, YAMAGATA));
        const a = datesFrom(QUIZ_EPOCH, 93).map((d) => buildDailyQuiz(p31, d)!.answer);
        for (let i = 0; i + 31 <= a.length; i++) expect(new Set(a.slice(i, i + 31)).size, `${i}`).toBe(31);
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

    it("ID も写真も同じで名前だけ違う2行でも、並びで答えが変わらない", () => {
        const a = pool.slice(0, 6);
        const renamed = a.map((s) => ({ ...s, name: `${s.name}（別）` }));
        for (const ymd of datesFrom("2026-10-01", 10)) {
            expect(buildDailyQuiz([...renamed, ...a], ymd), ymd).toEqual(buildDailyQuiz([...a, ...renamed], ymd));
        }
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

describe("日ごとのファイルの読み取り", () => {
    const pool = [1, 2, 3, 4, 5, 6].map((n) => spot(n, YAMAGATA));
    const good = () => JSON.parse(JSON.stringify(buildDailyQuiz(pool, "2026-10-01")));

    it("書き出した形はそのまま読める", () => {
        expect(parseDailyQuiz(good(), "2026-10-01")).toEqual(buildDailyQuiz(pool, "2026-10-01"));
    });

    it("日付違い・選択肢が4つでない・正解が無い・同じ選択肢・写真が https でない・作者が無いは読まない", () => {
        const bad: ((q: ReturnType<typeof good>) => void)[] = [
            (q) => { q.date = "2026-10-02"; },
            (q) => { q.choices = q.choices.slice(0, 3); },
            (q) => { q.answer = "sp_ffffffffffff"; },
            (q) => { q.choices[1] = q.choices[0]; },
            (q) => { q.photo.url = "http://example.com/x.jpg"; },
            (q) => { q.photo.author = ""; },
            (q) => { q.choices[0].slug = "../x"; },
        ];
        for (const [i, f] of bad.entries()) {
            const q = good();
            f(q);
            expect(parseDailyQuiz(q, "2026-10-01"), `${i}`).toBeNull();
        }
        expect(parseDailyQuiz(null, "2026-10-01")).toBeNull();
        expect(parseDailyQuiz("x", "2026-10-01")).toBeNull();
    });

    it("ライセンスの文面は http でも残す（写真の台帳に http の行がある）・それ以外の形は落とす", () => {
        const q = good();
        q.photo.licenseUrl = "http://creativecommons.org/licenses/by-sa/3.0";
        expect(parseDailyQuiz(q, "2026-10-01")!.photo.licenseUrl).toBe("http://creativecommons.org/licenses/by-sa/3.0");
        q.photo.licenseUrl = "javascript:alert(1)";
        expect(parseDailyQuiz(q, "2026-10-01")!.photo.licenseUrl).toBeUndefined();
    });

    it("regionLine は海外なら国から", () => {
        expect(regionLine({ prefecture: "山形県", city: "尾花沢市" })).toBe("山形県 尾花沢市");
        expect(regionLine({ country: "フランス", city: "パリ" })).toBe("フランス パリ");
        expect(regionLine({ country: "日本", prefecture: "京都府" })).toBe("京都府");
    });
});
