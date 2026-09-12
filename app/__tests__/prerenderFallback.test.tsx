import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * **事前描画で焼かれるのは Suspense の fallback。**
 *
 * `useSearchParams` を使うページは静的書き出しのために全体を
 * `<Suspense>` で包む。`output: "export"` のビルドが HTML に書くのは
 * **その fallback** で、中身ではない。つまり **JS が走る前に見えるのは
 * fallback だけ**——遅い回線・JS が落ちた・切っている状態で見えるのは
 * これ。
 *
 * 実際にここを落とした（2026-09-12）:
 *
 *   - `/j` と `/users` に見出しを足したが、**内側の loading 状態**に
 *     足していた。実ビルドの `out/j.html` は `h1=0` のままだった
 *   - `/login` と `/signup` は **fallback が空**で、事前描画の本文に
 *     `main` も見出しも1つも無かった（出るのはヘッダーとフッターだけ）
 *
 * **水和後の DOM を見る走査では捕まらない。** ここでは
 * `useSearchParams` に Promise を投げさせて**中断した状態**を作り、
 * fallback そのものを描いて見る。
 */
const pending = new Promise<never>(() => {});
vi.mock("next/navigation", () => ({
    useSearchParams: () => { throw pending; },
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    usePathname: () => "/",
}));
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false, userId: null }) }));
vi.mock("../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const PAGES: ReadonlyArray<readonly [string, () => Promise<{ default: React.ComponentType }>]> = [
    ["/login", () => import("../login/page")],
    ["/signup", () => import("../signup/page")],
    ["/j", () => import("../j/page")],
    ["/users", () => import("../users/page")],
];

describe("JS が走る前に焼かれる中身（Suspense の fallback）", () => {
    for (const [name, load] of PAGES) {
        it(`${name}: 見出しが1つある`, async () => {
            const Page = (await load()).default;
            const { container } = render(<Page />);
            const hs = container.querySelectorAll("h1");
            expect(hs.length, `${name} の fallback に見出しが無い`).toBe(1);
            expect(hs[0].textContent?.trim().length, "見出しが空").toBeGreaterThan(0);
        });

        it(`${name}: main が1つある`, async () => {
            const Page = (await load()).default;
            const { container } = render(<Page />);
            expect(container.querySelectorAll("main").length, `${name} の fallback に main が無い`).toBe(1);
        });
    }
});
