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
const share = vi.hoisted(() => vi.fn(async () => "shared"));
const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../../lib/utils/share", () => ({ shareUrl: share, copyToClipboard: copy }));
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
    copy.mockClear();
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
        // 答えは1回（4つとも押せない）
        const group = screen.getByRole("group", { name: "選択肢" });
        const choices = [...group.querySelectorAll("button")];
        expect(choices).toHaveLength(4);
        for (const b of choices) expect(b.disabled).toBe(true);
        // フォーカスは結果の見出しへ（そこで名前まで読まれる・読み上げの領域は別に置かない）
        await waitFor(() => expect(document.activeElement?.textContent).toBe("正解。銀山温泉"));
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("共有: 共有シートがあれば日付と ✓ だけ・無ければ結果の文ごとコピー（答えの名前は書かない）", async () => {
        render(<DailyQuizClient />);
        fireEvent.click(await screen.findByRole("button", { name: "銀山温泉" }));

        // 共有シートの無い端末（jsdom の既定）
        fireEvent.click(screen.getByRole("button", { name: "結果を共有" }));
        await waitFor(() => expect(copy).toHaveBeenCalled());
        const copied = (copy.mock.calls[0] as unknown as [string])[0];
        expect(copied).toContain("10/1");
        expect(copied).toContain("✓");
        expect(copied).toMatch(/\/q$/);
        expect(copied).not.toContain("銀山温泉");
        expect(share).not.toHaveBeenCalled();

        // 共有シートのある端末
        Object.defineProperty(navigator, "share", { value: vi.fn(), configurable: true });
        try {
            fireEvent.click(screen.getByRole("button", { name: "結果を共有" }));
            await waitFor(() => expect(share).toHaveBeenCalled());
            const [url, , text] = share.mock.calls[0] as unknown as [string, string, string];
            expect(url).toMatch(/\/q$/);
            expect(text).toContain("✓");
            expect(text).not.toContain("銀山温泉");
        } finally {
            delete (navigator as unknown as { share?: unknown }).share;
        }
    });

    it("共有シートに断られて URL だけ写ったら、結果の文ごと写し直す", async () => {
        share.mockImplementationOnce(async () => "copied");
        Object.defineProperty(navigator, "share", { value: vi.fn(), configurable: true });
        try {
            render(<DailyQuizClient />);
            fireEvent.click(await screen.findByRole("button", { name: "銀山温泉" }));
            fireEvent.click(screen.getByRole("button", { name: "結果を共有" }));
            await waitFor(() => expect(copy).toHaveBeenCalled());
            expect((copy.mock.calls[0] as unknown as [string])[0]).toMatch(/✓[\s\S]*\/q$/);
        } finally {
            delete (navigator as unknown as { share?: unknown }).share;
        }
    });

    it("白地は自分が選んだもの・外したら自分の選択に赤の縁、正解は「✓ 正解」の字", async () => {
        render(<DailyQuizClient />);
        fireEvent.click(await screen.findByRole("button", { name: "山寺" }));
        const chosen = screen.getByRole("button", { name: "山寺" });
        const answer = screen.getByRole("button", { name: /銀山温泉/ });
        expect(chosen.className).toContain("bg-primary");
        expect(chosen.getAttribute("aria-pressed")).toBe("true");
        expect(chosen.className).toContain("ring-danger");
        expect(answer.className).not.toContain("bg-primary");
        // 正解は字で示す。真鍮の輪はフォーカスの印と紛れるので付けない
        expect(answer.className).not.toContain("ring-accent");
        expect(answer.textContent).toContain("✓ 正解");
        // ✓ は飾り（読み上げの名前に入れない）
        expect(answer.querySelector("[aria-hidden='true']")?.textContent).toBe("✓ ");
        // 移った先は本物の見出し
        await waitFor(() => expect(document.activeElement?.tagName).toBe("H2"));
        await waitFor(() => expect(document.activeElement?.textContent).toBe("残念。銀山温泉"));
    });

    it("端末に残せなくても答えられる", async () => {
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
        try {
            render(<DailyQuizClient />);
            fireEvent.click(await screen.findByRole("button", { name: "銀山温泉" }));
            expect(screen.getByTestId("quiz-result").textContent).toContain("正解");
        } finally {
            spy.mockRestore();
        }
    });

    it("開いたまま日付をまたいで戻ってきたら、今日の問題を読み直す", async () => {
        render(<DailyQuizClient />);
        await screen.findByText("この写真はどこ？");
        fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => QUIZ("2026-10-02") }));
        vi.setSystemTime(new Date("2026-10-01T15:30:00Z"));
        document.dispatchEvent(new Event("visibilitychange"));
        await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/app/data/quiz/2026-10-02.json"));
        expect(await screen.findByText(/2026\.10\.02/)).toBeTruthy();
    });

    it("前日に答えたまま日付をまたぐと、今日の問題は答えていない状態で出る", async () => {
        render(<DailyQuizClient />);
        fireEvent.click(await screen.findByRole("button", { name: "銀山温泉" }));
        expect(screen.getByTestId("quiz-result")).toBeTruthy();
        fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => QUIZ("2026-10-02") }));
        vi.setSystemTime(new Date("2026-10-01T15:30:00Z"));
        document.dispatchEvent(new Event("visibilitychange"));
        await screen.findByText(/2026\.10\.02/);
        expect(screen.queryByTestId("quiz-result")).toBeNull();
        expect((screen.getByRole("button", { name: "銀山温泉" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("同じ日のうちに戻ってきても読み直さない", async () => {
        render(<DailyQuizClient />);
        await screen.findByText("この写真はどこ？");
        document.dispatchEvent(new Event("visibilitychange"));
        await new Promise((r) => setTimeout(r, 20));
        expect(fetchMock).toHaveBeenCalledTimes(1);
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
