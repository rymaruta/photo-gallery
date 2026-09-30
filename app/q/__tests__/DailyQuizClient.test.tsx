import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * 今日の一問の画面。固定したいのは:
 *  1. **日本時間の暦日**のファイルを読む（UTC の日付で読まない）
 *  2. 答えは1回。選んだものは日付ごとに端末へ残り、開き直しても結果のまま
 *  3. 「まだ読んでいる」「その日の問題が無い」「読めなかった」を混ぜない
 *  4. 写真の作者とライセンスは答える前から出す
 */
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: toast }) }));
const share = vi.hoisted(() => vi.fn(async () => "copied"));
vi.mock("../../../lib/utils/share", () => ({ shareUrl: share }));
vi.mock("../../components/SaveSpotButton", () => ({
    default: ({ slug, kind }: { slug: string; kind: string }) => <span data-testid="save">{`${kind}:${slug}`}</span>,
}));

import DailyQuizClient from "../DailyQuizClient";

const QUIZ = (date: string) => ({
    date,
    photo: {
        url: "https://journey-photo.com/images/spots/ginzan-onsen.jpg",
        author: "撮影者A",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
        pageUrl: "https://commons.wikimedia.org/wiki/File:Ginzan.jpg",
    },
    choices: [
        { spotId: "sp_000000000001", slug: "yamadera", name: "山寺", region: { prefecture: "山形県", city: "山形市" } },
        { spotId: "sp_000000000002", slug: "ginzan-onsen", name: "銀山温泉", region: { prefecture: "山形県", city: "尾花沢市" } },
        { spotId: "sp_000000000003", slug: "zao", name: "蔵王", region: { prefecture: "山形県" } },
        { spotId: "sp_000000000004", slug: "haguro", name: "羽黒山", region: { prefecture: "山形県" } },
    ],
    answer: "sp_000000000002",
});

const fetchMock = vi.fn();

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 2026-09-30 15:30 UTC ＝ 日本時間 10/1 00:30
    vi.setSystemTime(new Date("2026-09-30T15:30:00Z"));
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => QUIZ("2026-10-01") }));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.clear();
    toast.mockReset();
    share.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("今日の一問", () => {
    it("日本時間の暦日のファイルを読み、写真の出典を答える前から出す", async () => {
        render(<DailyQuizClient />);
        await screen.findByText("この写真はどこ？");
        expect(fetchMock).toHaveBeenCalledWith("/app/data/quiz/2026-10-01.json");
        expect(screen.getByText(/撮影者A/)).toBeTruthy();
        expect(screen.getByRole("link", { name: "CC BY-SA 4.0" }).getAttribute("href")).toContain("creativecommons.org");
        expect(screen.queryByTestId("quiz-result")).toBeNull();
    });

    it("正解を選ぶと結果・ガイド・行きたい・共有が出て、端末に残る", async () => {
        render(<DailyQuizClient />);
        fireEvent.click(await screen.findByRole("button", { name: "銀山温泉" }));
        const result = screen.getByTestId("quiz-result");
        expect(result.textContent).toContain("正解");
        expect(result.textContent).toContain("山形県 尾花沢市");
        expect(screen.getByRole("link", { name: "ガイドを見る" }).getAttribute("href")).toBe("/spots/ginzan-onsen");
        expect(screen.getByTestId("save").textContent).toBe("spot:ginzan-onsen");
        expect(window.localStorage.getItem("journey-photo:quiz:2026-10-01")).toBe("sp_000000000002");
        // 答えは1回
        for (const b of screen.getAllByRole("button", { pressed: false })) expect((b as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "結果を共有" }));
        await waitFor(() => expect(share).toHaveBeenCalled());
        const [url, , text] = share.mock.calls[0] as unknown as [string, string, string];
        expect(url).toMatch(/\/q$/);
        expect(text).toContain("10/1");
        expect(text).toContain("✓");
        // 答えの名前を共有文に書かない（受け取った人の問題を潰さない）
        expect(text).not.toContain("銀山温泉");
    });

    it("外すと「残念」と正解の名前", async () => {
        render(<DailyQuizClient />);
        fireEvent.click(await screen.findByRole("button", { name: "山寺" }));
        const result = screen.getByTestId("quiz-result");
        expect(result.textContent).toContain("残念");
        expect(result.textContent).toContain("銀山温泉");
    });

    it("開き直すと結果のまま・選んだものが選択肢に無ければ答えていない扱い", async () => {
        window.localStorage.setItem("journey-photo:quiz:2026-10-01", "sp_000000000003");
        const { unmount } = render(<DailyQuizClient />);
        expect((await screen.findByTestId("quiz-result")).textContent).toContain("残念");
        unmount();

        window.localStorage.setItem("journey-photo:quiz:2026-10-01", "sp_999999999999");
        render(<DailyQuizClient />);
        await screen.findByText("この写真はどこ？");
        expect(screen.queryByTestId("quiz-result")).toBeNull();
    });

    it("ファイルが無い日・中身が違う日は「まだありません」", async () => {
        fetchMock.mockImplementation(async () => ({ ok: false, status: 404, json: async () => null }));
        const { unmount } = render(<DailyQuizClient />);
        expect(await screen.findByText(/今日の一問はまだありません/)).toBeTruthy();
        unmount();

        fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => QUIZ("2026-09-30") }));
        render(<DailyQuizClient />);
        expect(await screen.findByText(/今日の一問はまだありません/)).toBeTruthy();
    });

    it("読めなかったときは断りと再読み込み（「まだありません」と言わない）", async () => {
        fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => null }));
        render(<DailyQuizClient />);
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.queryByText(/まだありません/)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
        await screen.findByText("この写真はどこ？");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
