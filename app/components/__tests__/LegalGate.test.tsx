import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 「はじめる前に」（iOS の LegalGateView と同じ）。ログインした人に一度だけ出す。
// 見るだけの人には出さない（Web はログインしなくても写真を見られる）

const nav = vi.hoisted(() => ({ pathname: "/" }));
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ ...auth }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));

import LegalGate from "../LegalGate";
import { LEGAL_CONSENT_KEY, LEGAL_CONSENT_VERSION, needsLegalConsent } from "../../../lib/utils/legalConsent";

const gate = () => screen.queryByRole("dialog", { name: "はじめる前に" });

beforeEach(() => {
    window.localStorage.clear();
    nav.pathname = "/";
    auth.isAuthenticated = true;
    auth.loading = false;
});

describe("はじめる前に（同意画面）", () => {
    it("見るだけの人（未ログイン）には出さない", () => {
        auth.isAuthenticated = false;
        render(<LegalGate />);
        expect(gate()).toBeNull();
    });

    it("ログインの確認中は出さない（確定してから判断する）", () => {
        auth.loading = true;
        render(<LegalGate />);
        expect(gate()).toBeNull();
    });

    it("ログインしていて同意の記録が無ければ出る。iOS と同じ3項目と規約への導線を持つ", async () => {
        render(<LegalGate />);
        expect(await screen.findByRole("dialog", { name: "はじめる前に" })).toHaveAttribute("aria-modal", "true");
        expect(screen.getByText(/旅の写真を投稿して共有できます/)).toBeInTheDocument();
        expect(screen.getByText(/いやがらせ・わいせつ・権利を侵す投稿は認めません/)).toBeInTheDocument();
        expect(screen.getByText(/撮影地は約1kmに丸めて保存します/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
        expect(screen.getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute("href", "/privacy");
    });

    it("同意すると閉じて、記録が残る（次からは出ない）", async () => {
        const { unmount } = render(<LegalGate />);
        await userEvent.click(await screen.findByRole("button", { name: "同意してはじめる" }));
        expect(gate()).toBeNull();
        expect(window.localStorage.getItem(LEGAL_CONSENT_KEY)).toBe(String(LEGAL_CONSENT_VERSION));
        unmount();
        render(<LegalGate />);
        expect(gate()).toBeNull();
    });

    it("Escape では閉じない（閉じる手段は同意だけ・iOS と同じ）", async () => {
        render(<LegalGate />);
        await screen.findByRole("dialog", { name: "はじめる前に" });
        await userEvent.keyboard("{Escape}");
        expect(gate()).not.toBeNull();
    });

    it("規約・プライバシーポリシーのページでは覆わない（覆うと読めない）", () => {
        nav.pathname = "/terms";
        const { unmount } = render(<LegalGate />);
        expect(gate()).toBeNull();
        unmount();
        nav.pathname = "/privacy/";
        render(<LegalGate />);
        expect(gate()).toBeNull();
    });

    it("保存できない端末でも、同意すれば閉じられる（出られなくなるとサイトが使えない）", async () => {
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
        render(<LegalGate />);
        await userEvent.click(await screen.findByRole("button", { name: "同意してはじめる" }));
        expect(gate()).toBeNull();
        spy.mockRestore();
    });
});

describe("同意の版", () => {
    /** 規約を変えて版を上げたら、同意済みの人にももう一度出す（iOS の requiredVersion と同じ） */
    it("古い版に同意済みなら、新しい版ではもう一度求める", () => {
        window.localStorage.setItem(LEGAL_CONSENT_KEY, "1");
        expect(needsLegalConsent(1)).toBe(false);
        expect(needsLegalConsent(2)).toBe(true);
    });

    it("記録が壊れていたら未同意に倒す", () => {
        window.localStorage.setItem(LEGAL_CONSENT_KEY, "abc");
        expect(needsLegalConsent(1)).toBe(true);
    });

    it("読めない端末では未同意に倒す", () => {
        const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
        expect(needsLegalConsent(1)).toBe(true);
        spy.mockRestore();
    });
});
