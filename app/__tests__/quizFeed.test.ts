import { describe, it, expect } from "vitest";
import { quizPool, quizDates, dailyQuizFor, QUIZ_DAYS_AHEAD } from "../../lib/data/quizFeed";
import { spotIndexFeed } from "../../lib/data/spotFeed";
import * as route from "../app/data/quiz/[file]/route";

/** **今日の一問のファイル**（`/app/data/quiz/<日付>.json`）。Web とアプリが同じものを読む */
describe("今日の一問のファイル", () => {
    it("候補は公開済みで写真のある行だけ", () => {
        const items = spotIndexFeed();
        const pool = quizPool(items);
        expect(pool.length).toBeGreaterThanOrEqual(4);
        const byId = new Map(items.map((i) => [i.spotId, i]));
        for (const s of pool) {
            const i = byId.get(s.spotId)!;
            expect(i.stage).toBe("published");
            expect(i.image?.url).toBeTruthy();
        }
        // いまは写真のある公開済みの行が全部サイトに控えを持つ（減ったら、控えの無い行が出てきた）
        expect(pool.length).toBe(items.filter((i) => i.stage === "published" && i.image).length);
        for (const s of pool) expect(new URL(s.image.url).pathname.startsWith("/images/spots/"), s.slug).toBe(true);
    });

    it("写真がサイトの控えでない行（Commons の元画像）は候補にしない", () => {
        const [base] = spotIndexFeed().filter((i) => i.stage === "published" && i.image);
        const remote = { ...base, spotId: "sp_ffffffffffff", image: { ...base.image!, url: "https://upload.wikimedia.org/x.jpg" } };
        expect(quizPool([base, remote]).map((s) => s.spotId)).toEqual([base.spotId]);
    });

    it("書き出す日付は日本時間の前日から60日先まで", () => {
        // 2026-09-30 15:30 UTC = 10/1 00:30 JST
        const dates = quizDates(new Date("2026-09-30T15:30:00Z"));
        expect(dates[0]).toBe("2026-09-30");
        expect(dates[1]).toBe("2026-10-01");
        expect(dates).toHaveLength(QUIZ_DAYS_AHEAD + 1);
    });

    it("運ぶのは写真・選択肢・正解だけ（本文や人名を運ばない）", () => {
        const q = dailyQuizFor("2026-10-01")!;
        expect(Object.keys(q).sort()).toEqual(["answer", "choices", "date", "photo"]);
        for (const c of q.choices) expect(Object.keys(c).sort()).toEqual(["name", "region", "slug", "spotId"]);
    });

    it("route は日付のファイルを返し、形の違う名前は 404", async () => {
        expect(route.dynamic).toBe("force-static");
        const ok = await route.GET(new Request("http://x"), { params: Promise.resolve({ file: "2026-10-01.json" }) });
        expect(ok.status).toBe(200);
        expect(JSON.parse(await ok.text())).toEqual(dailyQuizFor("2026-10-01"));
        const bad = await route.GET(new Request("http://x"), { params: Promise.resolve({ file: "2026-10-01.txt" }) });
        expect(bad.status).toBe(404);
        const params = route.generateStaticParams();
        expect(params.length).toBeGreaterThan(QUIZ_DAYS_AHEAD - 1);
        expect(params.every((p) => /^\d{4}-\d{2}-\d{2}\.json$/.test(p.file))).toBe(true);
    });
});
