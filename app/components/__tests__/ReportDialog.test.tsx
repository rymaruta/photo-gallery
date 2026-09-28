import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
    sessionErrorMessage: () => null,
}));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockToast }) }));
const mockSevered = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/hooks/useFollow", () => ({ noteFollowSevered: (...a: unknown[]) => mockSevered(...a) }));

import ReportDialog from "../ReportDialog";

const onClose = vi.fn();
beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    mockToast.mockReset();
    onClose.mockReset();
    mockSevered.mockReset();
});
const open = (locale = "ja") => render(<ReportDialog photoId="p1" locale={locale} onClose={onClose} />);
const body = () => JSON.parse((mockUserFetch.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>;

describe("通報のダイアログ", () => {
    /** モーダルの作法。既存の8か所と同じ道具を通しているか */
    it("ダイアログとして名前を持つ", () => {
        open();
        const dlg = screen.getByRole("dialog");
        expect(dlg).toHaveAttribute("aria-modal", "true");
        expect(dlg, "名前が無い（読み上げで何のダイアログか分からない）").toHaveAccessibleName();
    });

    it("Escape で閉じる", async () => {
        open();
        await userEvent.keyboard("{Escape}");
        expect(onClose).toHaveBeenCalled();
    });

    it("背景を押すと閉じる", async () => {
        const { container } = open();
        await userEvent.click(container.querySelector('[aria-hidden="true"]')!);
        expect(onClose).toHaveBeenCalled();
    });

    /** **理由を選ばないと送れない。** 選ばせずに送ると 400 で返ってくる */
    it("理由を選ぶまで送信できない", async () => {
        open();
        const send = screen.getByRole("button", { name: "通報する" });
        expect(send, "理由なしで押せる").toBeDisabled();
        await userEvent.click(screen.getByLabelText("広告・勧誘・スパム"));
        expect(send).toBeEnabled();
    });

    it("選んだ理由を送る", async () => {
        open();
        await userEvent.click(screen.getByLabelText("わいせつな内容"));
        await userEvent.click(screen.getByRole("button", { name: "通報する" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(mockUserFetch.mock.calls[0][0]).toBe("/photos/p1/report");
        expect(body().reason).toBe("sexual");
    });

    it("補足も送る（空なら送らない）", async () => {
        open();
        await userEvent.click(screen.getByLabelText("その他"));
        await userEvent.type(screen.getByLabelText("補足（任意）"), "  困っています  ");
        await userEvent.click(screen.getByRole("button", { name: "通報する" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(body().note, "前後の空白を落としていない").toBe("困っています");
    });

    it("補足が空なら項目ごと送らない", async () => {
        open();
        await userEvent.click(screen.getByLabelText("その他"));
        await userEvent.click(screen.getByRole("button", { name: "通報する" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect("note" in body()).toBe(false);
    });

    /** **「対応しました」とは言わない。** 読むのは人で、すぐには終わらない */
    it("受け付けたことだけ伝えて閉じる", async () => {
        open();
        await userEvent.click(screen.getByLabelText("広告・勧誘・スパム"));
        await userEvent.click(screen.getByRole("button", { name: "通報する" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        const msg = String(mockToast.mock.calls[0][0]);
        expect(msg).toContain("受け付け");
        expect(msg, "消したと誤解させる").not.toContain("削除");
    });

    it("断られたら理由を出して閉じない", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "x" }) });
        open();
        await userEvent.click(screen.getByLabelText("広告・勧誘・スパム"));
        await userEvent.click(screen.getByRole("button", { name: "通報する" }));
        await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), "error"));
        expect(onClose, "失敗したのに閉じている").not.toHaveBeenCalled();
    });

    it("英語UIでは英語で出す", () => {
        open("en");
        expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
        expect(screen.getByLabelText("Spam")).toBeInTheDocument();
    });

    /**
     * **通報と一緒にブロックできる**（iOS の通報画面と同じ）。出すのは相手が
     * 分かるときだけ——自分の投稿や持ち主の分からない投稿で出すと、押しても
     * 誰もブロックされない
     */
    describe("この人をブロックする", () => {
        const openWithTarget = () => render(<ReportDialog photoId="p1" blockTargetId="u9" locale="ja" onClose={onClose} />);
        const urls = () => mockUserFetch.mock.calls.map((c) => String(c[0]));

        it("相手が分からないときは出さない", () => {
            open();
            expect(screen.queryByRole("checkbox", { name: /ブロックする/ })).toBeNull();
        });

        it("既定は外れていて、外したままならブロックしない", async () => {
            openWithTarget();
            expect(screen.getByRole("checkbox", { name: /ブロックする/ })).not.toBeChecked();
            await userEvent.click(screen.getByLabelText("広告・勧誘・スパム"));
            await userEvent.click(screen.getByRole("button", { name: "通報する" }));
            await waitFor(() => expect(onClose).toHaveBeenCalled());
            expect(urls()).toEqual(["/photos/p1/report"]);
        });

        it("入れて送ると、通報のあとで相手をブロックし、フォローの表示も直す", async () => {
            openWithTarget();
            await userEvent.click(screen.getByLabelText("広告・勧誘・スパム"));
            await userEvent.click(screen.getByRole("checkbox", { name: /ブロックする/ }));
            await userEvent.click(screen.getByRole("button", { name: "通報する" }));
            await waitFor(() => expect(onClose).toHaveBeenCalled());
            expect(urls(), "通報より先にブロックしている／ブロックしていない").toEqual(["/photos/p1/report", "/users/u9/block"]);
            expect((mockUserFetch.mock.calls[1][1] as { method: string }).method).toBe("POST");
            expect(mockSevered).toHaveBeenCalledWith("u9");
            expect(String(mockToast.mock.calls[0][0])).toContain("ブロックしました");
        });

        it("通報が断られたらブロックしない", async () => {
            mockUserFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "x" }) });
            openWithTarget();
            await userEvent.click(screen.getByLabelText("広告・勧誘・スパム"));
            await userEvent.click(screen.getByRole("checkbox", { name: /ブロックする/ }));
            await userEvent.click(screen.getByRole("button", { name: "通報する" }));
            await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), "error"));
            expect(urls()).toEqual(["/photos/p1/report"]);
        });

        it("ブロックだけ失敗したら、通報は受け付けたと言い、ブロックの失敗を別に伝える", async () => {
            mockUserFetch
                .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
                .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "x" }) });
            openWithTarget();
            await userEvent.click(screen.getByLabelText("広告・勧誘・スパム"));
            await userEvent.click(screen.getByRole("checkbox", { name: /ブロックする/ }));
            await userEvent.click(screen.getByRole("button", { name: "通報する" }));
            await waitFor(() => expect(onClose).toHaveBeenCalled());
            expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("通報を受け付けました"), "success");
            expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("ブロックはできませんでした"), "error");
            expect(mockSevered).not.toHaveBeenCalled();
        });
    });
});
