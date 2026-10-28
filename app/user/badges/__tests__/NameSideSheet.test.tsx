import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 2026-10-11: 390px で Pro マークの形の3択が「絞り羽／根」「PRO／の札」と2行に折れていた
// （札と同じ行に置き、選択肢の幅が max-w-[290px] の中で約 85px）。札を上の行、選択肢を下の行に
// 横いっぱい（iOS と同じ）。公式の印の段もそろえる。冒頭の説明は文の切れ目で折る。

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import NameSideSheet from "../NameSideSheet";

const AT = "2026-10-01T00:00:00.000Z";
const profile = {
    displayBadge: "prefectures" as const, proMarkStyle: "iris" as const, verifiedMarkOff: false, earlyMarkOn: null,
    pro: true, verified: true, displayName: "旅する写真家",
    badges: { prefectures: { tier: 2, at: AT }, supporterYear: { tier: 1, at: AT } },
};

function renderSheet() {
    return render(
        <NameSideSheet profile={profile} locale="ja" onClose={() => {}} onSaved={() => {}}
            restoreRef={{ current: null }} showToast={() => {}} />,
    );
}

describe("名前の横の設定: 390px で選択肢の文字が折れない並び", () => {
    it("Pro マークの形: 札が上の行、選択肢は下の行に横いっぱい（幅の上限なし）", () => {
        renderSheet();
        for (const id of ["name-side-pro-mark", "name-side-verified"]) {
            const fs = screen.getByTestId(id);
            // 札と選択肢を横に並べない
            expect(fs.className).not.toContain("flex");
            const [label, group] = [...fs.children].filter((el) => el.tagName !== "LEGEND");
            expect(label.className).toMatch(/(^|\s)(block|flex)(\s|$)/);
            expect(group.className).toContain("w-full");
            expect(group.className).not.toMatch(/max-w-/);
        }
        expect(screen.getByRole("radio", { name: /絞り羽根/ })).toBeTruthy();
    });

    it("冒頭の説明は文の切れ目で折る（「す。」だけ落とさない）", () => {
        renderSheet();
        const spans = [...screen.getByTestId("name-side-lead").querySelectorAll("span.inline-block")];
        expect(spans.map((s) => s.textContent)).toEqual(["名前の横に出すメダルを1つ選びます。", "もう一度押すと外れます。"]);
    });

    it("メダルの名前の段はひとかたまりで折る（「続けた年（1年／目）」にしない）", () => {
        renderSheet();
        const tiers = screen.getAllByTestId("medal-name-tier").map((el) => el.textContent);
        expect(tiers).toContain("（1年目）");
    });
});

// 初期メンバーの印（2026-10-28 owner「デフォルトでは付与・外すのはユーザーの任意」）
describe("名前の横の設定: 初期メンバーの印", () => {
    const early = {
        displayBadge: null, proMarkStyle: "iris" as const, verifiedMarkOff: false, earlyMarkOn: null,
        pro: false, verified: false, displayName: "旅する写真家",
        badges: { earlyUser: { tier: 1, at: AT }, first: { tier: 1, at: AT } },
    };
    const open = (p: typeof early | typeof profile) => render(
        <NameSideSheet profile={p} locale="ja" onClose={() => {}} onSaved={() => {}}
            restoreRef={{ current: null }} showToast={() => {}} />,
    );

    it("資格の無い人には段を出さない・下見にも出ない", () => {
        open(profile);
        expect(screen.queryByTestId("name-side-early")).toBeNull();
        expect(screen.getByTestId("name-side-preview").querySelector("[data-testid=early-mark]")).toBeNull();
    });

    it("既定（決めていない・他の印なし）: 下見に出る。どちらも選ばれておらず、自動で付いていると言う", () => {
        open(early);
        expect(screen.getByTestId("name-side-preview").querySelector("[data-testid=early-mark]")).not.toBeNull();
        const fs = screen.getByTestId("name-side-early");
        expect((fs.querySelector("input[value=on]") as HTMLInputElement).checked).toBe(false);
        expect((fs.querySelector("input[value=off]") as HTMLInputElement).checked).toBe(false);
        expect(screen.getByTestId("name-side-early-auto").textContent).toContain("自動で付いています");
        // 選ばれていない間は、この一行が状態を伝える唯一の手段なので読み上げにも結ぶ
        expect(screen.getByRole("group", { name: "初期メンバーの印" }).getAttribute("aria-describedby")).toBe("name-side-early-auto");
    });

    // レビューの指摘（2026-10-28）: 既定で出ている人の「付ける」が最初から選ばれていると、押しても
    // 何も起きず、決めたつもりで既定のまま残る（あとでメダルを選ぶと消える）
    it("既定で出ている人が「付ける」を押すと、earlyMarkOn: true を送る（並べて出し続ける）", async () => {
        mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ...early, earlyMarkOn: true }) });
        open(early);
        fireEvent.click(screen.getByTestId("name-side-early").querySelector("input[value=on]")!);
        expect(screen.queryByTestId("name-side-early-auto")).toBeNull();
        // 決めた後はメダルを選んでも下見から消えない
        fireEvent.click(screen.getByRole("button", { name: "最初の一枚" }));
        expect(screen.getByTestId("name-side-preview").querySelector("[data-testid=early-mark]")).not.toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "決める" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(JSON.parse(mockUserFetch.mock.calls[0][1].body)).toEqual({ displayBadge: "first", earlyMarkOn: true });
    });

    it("他の印が出ていて自動で外れている人には、そう言う", () => {
        open({ ...early, pro: true });
        expect(screen.getByTestId("name-side-preview").querySelector("[data-testid=early-mark]")).toBeNull();
        expect(screen.getByTestId("name-side-early-auto").textContent).toContain("自動で外れています");
    });

    it("既定のままメダルを選ぶと、下見から消える（他の印が出るので）", () => {
        open(early);
        expect(screen.getByTestId("name-side-preview").querySelector("[data-testid=early-mark]")).not.toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "最初の一枚" }));
        expect(screen.getByTestId("name-side-preview").querySelector("[data-testid=early-mark]")).toBeNull();
    });

    it("「外す」で決めると earlyMarkOn: false だけ送る", async () => {
        mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ...early, earlyMarkOn: false }) });
        open(early);
        fireEvent.click(screen.getByTestId("name-side-early").querySelector("input[value=off]")!);
        expect(screen.getByTestId("name-side-preview").querySelector("[data-testid=early-mark]")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "決める" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(JSON.parse(mockUserFetch.mock.calls[0][1].body)).toEqual({ earlyMarkOn: false });
    });
});
