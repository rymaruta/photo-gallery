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
    ["/user/edit", () => import("../user/edit/page")],
    ["/user/highlights", () => import("../user/highlights/page")],
    ["/user/upload", () => import("../user/upload/page")],
    ["/admin/edit", () => import("../admin/edit/page")],
];

describe("JS が走る前に焼かれる中身（Suspense の fallback）", () => {
    /**
     * **JSX のコメントは `{/*…*\/}`。** `//` で書くとそのまま**文字として
     * 描かれる**。この一群を直しているときに実際にやり、実ビルドの
     * `/user/edit` と `/admin/edit` の本文に解説文が出ていた
     * （`tsc` も `eslint` も通る）。
     */
    it("fallback にコメントの文字が漏れていない", async () => {
        for (const [name, load] of PAGES) {
            const Page = (await load()).default;
            const { container, unmount } = render(<Page />);
            expect(container.textContent ?? "", `${name} にコメントが漏れている`).not.toMatch(/\/\/|事前描画|sr-only は/);
            unmount();
        }
    });

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

/**
 * **一覧そのものを縛る。**
 *
 * 上の `PAGES` は手書きなので、`useSearchParams` を使うページが8つ目に
 * 増えても**この守りは静かに素通りする**。`1b150344` / `9cf264b0` で
 * 立てた型（「その入口は全部か」を数える）をここにも当てる。
 *
 * なぜ `useSearchParams` かというと、**それを使うページは全体が Suspense で
 * 包まれる**ので、静的書き出しで焼かれるのは中身ではなく fallback になる
 * ——`8ec1dd8e` 〜 `53e2307c` で12ページ直したときの根がこれで、
 * 「内側の loading 状態に足しても静的HTMLには入らない」を2回続けて落とした。
 */
describe("見る対象の一覧が、実際の page.tsx と合っている", () => {
    it("useSearchParams を使うページは全部 PAGES に在る", async () => {
        const { readdirSync, readFileSync, statSync } = await import("node:fs");
        const { join, relative } = await import("node:path");
        const root = join(process.cwd(), "app");
        const found: string[] = [];
        const stack = [root];
        while (stack.length > 0) {
            const dir = stack.pop()!;
            for (const name of readdirSync(dir)) {
                if (name === "__tests__" || name === "api") continue;
                const full = join(dir, name);
                if (statSync(full).isDirectory()) { stack.push(full); continue; }
                if (name !== "page.tsx") continue;
                if (!readFileSync(full, "utf8").includes("useSearchParams")) continue;
                // "app/login/page.tsx" → "/login"
                const rel = relative(root, full).split("\\").join("/").replace(/\/page\.tsx$/, "");
                found.push(rel === "page.tsx" ? "/" : `/${rel}`);
            }
        }
        const listed = PAGES.map(([route]) => route);
        expect(found.sort(), `一覧に無いページがある（足すか、理由を書いて外す）`).toEqual([...listed].sort());
    });

    // **走査が空振りしていないこと。** パスの組み立てを間違えると
    // 「0件 === 0件」ではなく「0件 ≠ 7件」で落ちるが、逆に PAGES を
    // 空にした変異は気づけない。数の下限も見る
    it("一覧が空でない", () => {
        expect(PAGES.length).toBeGreaterThan(5);
    });
});

