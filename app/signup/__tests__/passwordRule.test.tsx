import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * **パスワードの条件が、欄に結ばれていなかった。**
 *
 * 「英大文字・小文字・数字・記号（!@#$など）をそれぞれ1文字以上」は
 * この1文にしか書いていない。ラベルは「パスワード」としか言わないので、
 * 結ばないと読み上げには**満たすべき条件が一度も届かない**まま弾かれる
 * ——新規登録はこの画面が唯一の進み方で、`MemberOnlyNotice` のような
 * 出口も無い。
 *
 * 台帳が同じ文について一度「読めないとアカウントが作れない文」として
 * コントラストを上げている（`f9db0c6f`）。**見えるようにはしたが、
 * 読み上げには渡していなかった。**
 */
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => ({
    signUp: vi.fn(), confirmSignUp: vi.fn(), resendConfirmationCode: vi.fn(),
}));
vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) =>
        React.createElement("a", { href }, children),
}));

const SignupPage = (await import("../page")).default;

describe("/signup: パスワードの条件が読み上げに届く", () => {
    it("条件の文が入力欄に結ばれている", () => {
        const { container } = render(<SignupPage />);
        const input = container.querySelector("#signup-password") as HTMLInputElement;
        expect(input, "パスワードの欄が見つからない").not.toBeNull();
        const id = input.getAttribute("aria-describedby");
        expect(id, "条件の文が欄に結ばれていない").toBeTruthy();
        const hint = container.querySelector(`#${CSS.escape(id!)}`);
        expect(hint?.textContent, "結んだ先が条件の文ではない").toContain("記号");
    });

    // 指す先が消えたら（文言を別の要素へ移したときなど）気づく
    it("指す先が実在する", () => {
        const { container } = render(<SignupPage />);
        for (const el of container.querySelectorAll("[aria-describedby]")) {
            for (const id of (el.getAttribute("aria-describedby") ?? "").split(/[ \t\n]+/).filter(Boolean)) {
                expect(container.querySelector(`#${CSS.escape(id)}`), `${id} が実在しない`).not.toBeNull();
            }
        }
    });
});
