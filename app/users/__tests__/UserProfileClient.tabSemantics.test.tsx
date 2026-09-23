import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * 🔴 **マイページのタブが「本物のタブ」であること。**
 *
 * 2026-09-22 まで `aria-pressed` のボタンだった。`aria-pressed` は
 * 「押して入り切りする」という意味なので、**押し直しても外れない**この2つに
 * 付けると嘘になる——読み上げは「押されています」と言うのに、もう一度
 * 押しても何も起きない。実測でもこの画面だけ `[role="tab"]` が **0個**で、
 * 写真ページ（2個）・通知ベルと形が割れていた。
 *
 * 計算は `lib/utils/tabKeys.ts` に1つ（写真ページ・通知ベルと共有）。
 * **矢印で動かせないと `role="tab"` は壊れて見える**ので、そこも見る。
 */
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "en" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn().mockResolvedValue(null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: vi.fn().mockResolvedValue({ ok: false }),
        userFetch: vi.fn().mockResolvedValue({ ok: false }),
        userPublicFetch: vi.fn().mockResolvedValue({ ok: false }),
    };
});

import UserProfileClient from "../UserProfileClient";

const tabs = () => screen.getAllByRole("tab");
const selected = () => tabs().find((t) => t.getAttribute("aria-selected") === "true");

describe("マイページのタブの意味づけ", () => {
    it("🔴 `role=\"tablist\"` の中の `role=\"tab\"` で、選択中は `aria-selected`", () => {
        render(<UserProfileClient userId="nobody" />);
        expect(screen.getByRole("tablist")).toBeTruthy();
        expect(tabs()).toHaveLength(2);
        expect(selected()?.textContent).toContain("Posts");
        // **`aria-pressed` は名乗らない**（押し直しても外れないので嘘になる）
        for (const t of tabs()) expect(t.hasAttribute("aria-pressed"), "`aria-pressed` が残っている").toBe(false);
    });

    // roving tabindex（停止点は1つ）。無いと、タブの数だけ Tab を押すことになる
    it("止まれるのは選択中のタブだけ", () => {
        render(<UserProfileClient userId="nobody" />);
        expect(tabs().map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    });

    // 🔴 `role="tab"` を名乗った以上、矢印で動かないと壊れて見える
    it("矢印キーで隣のタブへ動き、フォーカスも移る", () => {
        render(<UserProfileClient userId="nobody" />);
        fireEvent.keyDown(selected()!, { key: "ArrowRight" });
        expect(selected()?.textContent).toContain("Timeline");
        expect(document.activeElement).toBe(selected());
        // 端で折り返す（`tabKeys.ts` の規則）
        fireEvent.keyDown(selected()!, { key: "ArrowRight" });
        expect(selected()?.textContent).toContain("Posts");
    });

    it("関係ないキーは飲まない", () => {
        render(<UserProfileClient userId="nobody" />);
        const before = selected()?.textContent;
        const e = fireEvent.keyDown(selected()!, { key: "Tab" });
        expect(e, "`Tab` を飲んでいる（キーボードだけの人がタブから出られない）").toBe(true);
        expect(selected()?.textContent).toBe(before);
    });

    it("タブが指す中身が実在する（`aria-controls` の行き先）", () => {
        render(<UserProfileClient userId="nobody" />);
        const id = selected()!.getAttribute("aria-controls")!;
        const panel = document.getElementById(id);
        expect(panel, `${id} が無い`).toBeTruthy();
        expect(panel!.getAttribute("role")).toBe("tabpanel");
        expect(panel!.getAttribute("aria-labelledby")).toBe(selected()!.id);
    });
});
