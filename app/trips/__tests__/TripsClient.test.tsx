import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { SpotLink } from "../../../lib/data/spotLink";

/**
 * 旅行プランの画面。
 *
 * 固定したいのは5つ:
 *
 *  1. **「まだ」「聞けなかった」「0件」を混ぜない**
 *  2. **未ログインはログインへ送る**（押してから断らない）
 *  3. **項目は「行きたい場所」から選ぶ**（自由入力を作らない）
 *  4. **消す前に一度聞く**（日程ごと消えて戻せない）
 *  5. **サーバーの言い分をそのまま出す**（上限・混雑を潰さない）
 */
const hooks = vi.hoisted(() => ({
    auth: { isAuthenticated: true, loading: false },
    trips: {
        plans: [] as unknown[],
        pending: false, failed: false, busy: null as string | null, error: null as string | null,
        retry: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    },
    saved: { slugs: [] as string[] },
    photos: { photos: [] as unknown[], loaded: true },
}));

vi.mock("../../auth/context", () => ({ useAuth: () => hooks.auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useTripPlans", () => ({ useTripPlans: () => hooks.trips }));
vi.mock("../../../lib/hooks/useSavedSpots", () => ({ useSavedSpots: () => hooks.saved }));
vi.mock("../../../lib/hooks/usePhotos", () => ({ usePhotos: () => hooks.photos }));

const TripsClient = (await import("../TripsClient")).default;
const { splitChoice, itemLabel } = await import("../TripsClient");

const SPOTS: Record<string, SpotLink> = {
    sp_0123456789ab: { slug: "takaya-jinja", name: "高屋神社", region: "香川県 観音寺市", cover: null },
};

const draw = () => render(<TripsClient spots={SPOTS} />);

const plan = (planId: string, over: Record<string, unknown> = {}) =>
    ({ planId, title: `旅 ${planId}`, days: [], ...over });

beforeEach(() => {
    cleanup();
    hooks.auth = { isAuthenticated: true, loading: false };
    hooks.trips = {
        plans: [], pending: false, failed: false, busy: null, error: null,
        retry: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    };
    hooks.saved = { slugs: [] };
    hooks.photos = { photos: [], loaded: true };
});

describe("状態を混ぜない", () => {
    it("未ログインはログインへ送る（作る口を出さない）", () => {
        hooks.auth = { isAuthenticated: false, loading: false };
        draw();
        expect(screen.getByRole("link", { name: "ログイン" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /作る/ })).toBeNull();
    });

    it("取得中は「まだありません」と言わない", () => {
        hooks.trips.pending = true;
        draw();
        expect(screen.getByText("読み込み中…")).toBeTruthy();
        expect(screen.queryByText(/まだありません/)).toBeNull();
        expect(screen.queryByText(/旅行プラン 0 件/), "件数まで出している").toBeNull();
    });

    it("🔴 聞けなかった回は、断りと再試行を出して「0件」と言わない", () => {
        hooks.trips.failed = true;
        draw();
        expect(screen.getByRole("alert").textContent).toContain("読み込めませんでした");
        expect(screen.queryByText(/まだありません/)).toBeNull();
        expect(screen.queryByText(/旅行プラン 0 件/)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "再試行" }));
        expect(hooks.trips.retry).toHaveBeenCalled();
    });

    it("本当に0件のときだけ「まだありません」", () => {
        draw();
        expect(screen.getByText("旅行プランはまだありません。")).toBeTruthy();
        expect(screen.getByText("旅行プラン 0 件")).toBeTruthy();
    });

    it("🔴 サーバーの言い分をそのまま出す", () => {
        hooks.trips.error = "旅行プランは50個までです。使わないものを消してください";
        draw();
        expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("50個まで"))).toBe(true);
    });
});

describe("作る", () => {
    it("題を入れて押すと作る（空では押せない）", async () => {
        hooks.trips.create = vi.fn(async () => plan("new1"));
        draw();
        const btn = screen.getByRole("button", { name: /作る/ });
        expect(btn.hasAttribute("disabled"), "空でも押せる").toBe(true);
        fireEvent.change(screen.getByLabelText("旅行プランのタイトル"), { target: { value: " 北欧の冬 " } });
        fireEvent.click(screen.getByRole("button", { name: /作る/ }));
        await waitFor(() => expect(hooks.trips.create).toHaveBeenCalledWith("北欧の冬"));
    });

    it("🔴 取得に失敗していても作る口は出す（新しく作るのに一覧は要らない）", () => {
        hooks.trips.failed = true;
        draw();
        expect(screen.getByRole("button", { name: /作る/ })).toBeTruthy();
    });
});

describe("一覧と削除", () => {
    it("題・期間・何か所かを出す", () => {
        hooks.trips.plans = [plan("a", {
            title: "冬のフィンランド", startDate: "2026-12-24", endDate: "2026-12-28",
            days: [{ items: [{ kind: "location", slug: "パリ" }, { kind: "spot", spotId: "sp_0123456789ab" }] }],
        })];
        draw();
        expect(screen.getByText("冬のフィンランド")).toBeTruthy();
        // **サイトの他の画面と同じ形**（`2026-12-24` の生の値では出さない）
        expect(screen.getByText("2026年12月24日 〜 2026年12月28日 ・ 2 か所")).toBeTruthy();
        expect(screen.queryByText(/2026-12-24/), "保存されている生の値がそのまま出ている").toBeNull();
    });

    /**
     * **日付を書いていないプランに、こちらで作った言葉を置かない。**
     * 「日程未定」のような字を足すと、書いたのか書いていないのかが
     * 画面から読めなくなる（`/saved-spots` の「不明な場所」と同じ判断）。
     */
    it("🔴 読めない日付は出さない（作り話の日付を作らない）", () => {
        hooks.trips.plans = [plan("a", { startDate: "こわれ", endDate: "2026-13-99" })];
        draw();
        expect(screen.getByText("0 か所")).toBeTruthy();
        expect(screen.queryByText(/こわれ|2026/), "読めない値をそのまま出している").toBeNull();
    });

    it("🔴 日付が無ければ、期間の欄ごと出さない", () => {
        hooks.trips.plans = [plan("a", { days: [{ items: [{ kind: "location", slug: "パリ" }] }] })];
        draw();
        expect(screen.getByText("1 か所")).toBeTruthy();
        expect(screen.queryByText(/未定|〜/), "書いていない期間を作っている").toBeNull();
    });

    it("片方だけの日付は、その1つを出す", () => {
        hooks.trips.plans = [plan("a", { startDate: "2026-12-24" })];
        draw();
        expect(screen.getByText("2026年12月24日 ・ 0 か所")).toBeTruthy();
    });

    it("🔴 消す前に一度聞く（押しただけでは消えない）", () => {
        hooks.trips.plans = [plan("a")];
        draw();
        fireEvent.click(screen.getByRole("button", { name: "「旅 a」を削除" }));
        expect(hooks.trips.remove, "確認なしで消した").not.toHaveBeenCalled();
        expect(screen.getByText("この旅行プランを削除しますか？")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "削除する" }));
        expect(hooks.trips.remove).toHaveBeenCalledWith("a");
    });

    it("やめれば消さない", () => {
        hooks.trips.plans = [plan("a")];
        draw();
        fireEvent.click(screen.getByRole("button", { name: "「旅 a」を削除" }));
        fireEvent.click(screen.getByRole("button", { name: "やめる" }));
        expect(screen.queryByText("この旅行プランを削除しますか？")).toBeNull();
        expect(hooks.trips.remove).not.toHaveBeenCalled();
    });
});

describe("日程の編集", () => {
    const open = (over: Record<string, unknown> = {}) => {
        hooks.trips.plans = [plan("a", over)];
        draw();
        fireEvent.click(screen.getByRole("button", { expanded: false }));
    };

    it("ひらくまで編集は出ない", () => {
        hooks.trips.plans = [plan("a")];
        draw();
        expect(screen.queryByRole("button", { name: /日を追加/ })).toBeNull();
    });

    it("日を足して、保存で送る", async () => {
        open();
        fireEvent.click(screen.getByRole("button", { name: /日を追加/ }));
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(hooks.trips.update).toHaveBeenCalledWith("a", {
            days: [{ items: [] }], startDate: "", endDate: "",
        }));
    });

    it("🔴 変えていなければ保存を押せない（他のタブの編集を打ち消さない）", () => {
        open();
        expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);
    });

    /**
     * 🔴 **日の見出しの日付も、サイトの形で出す。**
     * 期間（カードの上）だけ直して、日程の中の日付を生のまま残す
     * ——同じ画面に2つの見え方が並ぶ形を作らない。
     */
    it("🔴 日の見出しの日付も年月日の形で出す", () => {
        open({ days: [{ date: "2026-12-24", items: [] }] });
        expect(screen.getByText("1 日目・2026年12月24日")).toBeTruthy();
        expect(screen.queryByText(/2026-12-24/), "保存されている生の値がそのまま出ている").toBeNull();
    });

    it("読めない日付の日は、日付を出さずに「N 日目」だけ", () => {
        open({ days: [{ date: "2026-13-99", items: [] }] });
        expect(screen.getByText("1 日目")).toBeTruthy();
        expect(screen.queryByText(/2026/), "読めない値をそのまま出している").toBeNull();
    });

    it("🔴 項目は「行きたい場所」から選ぶ（自由入力の欄が無い）", () => {
        hooks.saved = { slugs: ["SPOT-takaya-jinja"] };
        open({ days: [{ items: [] }] });
        const select = screen.getByLabelText("行きたい場所から追加") as HTMLSelectElement;
        expect([...select.options].map((o) => o.textContent)).toContain("高屋神社");
        // 日程の中に、場所を打ち込む入力欄は無い（日付の2つだけ）
        expect(screen.queryByPlaceholderText(/場所|place/i)).toBeNull();
    });

    it("保存した場所が1つも無ければ、選ぶ口を押させない（理由を出す）", () => {
        open({ days: [{ items: [] }] });
        const select = screen.getByLabelText("行きたい場所から追加") as HTMLSelectElement;
        expect(select.disabled).toBe(true);
        expect(select.options[0].textContent).toBe("先に「行きたい場所」に保存してください");
    });

    it("選ぶと日程に入り、外せる", async () => {
        hooks.saved = { slugs: ["SPOT-takaya-jinja"] };
        open({ days: [{ items: [] }] });
        // **名前で数えない**——同じ字が候補の `<option>` にも出る。
        // 日程に入ったことは「外す」ボタンの有無で見る
        expect(screen.queryByRole("button", { name: "「高屋神社」を外す" })).toBeNull();
        fireEvent.change(screen.getByLabelText("行きたい場所から追加"), { target: { value: "spot:sp_0123456789ab" } });
        const remove = screen.getByRole("button", { name: "「高屋神社」を外す" });
        expect(screen.getAllByText("高屋神社"), "候補と日程の2か所に出る").toHaveLength(2);
        fireEvent.click(remove);
        expect(screen.queryByRole("button", { name: "「高屋神社」を外す" })).toBeNull();
        expect(screen.getAllByText("高屋神社"), "候補からは消えない").toHaveLength(1);
    });

    it("🔴 開き直したらサーバーの姿に戻る（打ちかけを持ち越さない）", () => {
        hooks.trips.plans = [plan("a", { days: [] })];
        const { rerender } = draw();
        fireEvent.click(screen.getByRole("button", { expanded: false }));
        fireEvent.click(screen.getByRole("button", { name: /日を追加/ }));
        expect(screen.getByText("1 日目")).toBeTruthy();
        // サーバーが別の姿を返した（別のタブで直した）
        hooks.trips.plans = [plan("a", { days: [{ items: [] }, { items: [] }] })];
        rerender(<TripsClient spots={SPOTS} />);
        expect(screen.getByText("2 日目")).toBeTruthy();
        expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled"), "打ちかけが残っている").toBe(true);
    });
});

describe("道具の自己確認", () => {
    it("`splitChoice` は種別と ID に割る（知らない形は割らない）", () => {
        expect(splitChoice("spot:sp_1")).toEqual(["spot", "sp_1"]);
        expect(splitChoice("location:パリ, フランス")).toEqual(["location", "パリ, フランス"]);
        expect(splitChoice("hotel:x")).toEqual([null, ""]);
        expect(splitChoice("spot:")).toEqual([null, ""]);
        expect(splitChoice("spot")).toEqual([null, ""]);
    });
    it("`itemLabel` は引けないとき ID をそのまま出す（作り話の名前を置かない）", () => {
        expect(itemLabel({ kind: "spot", spotId: "sp_0123456789ab" }, SPOTS)).toBe("高屋神社");
        expect(itemLabel({ kind: "spot", spotId: "sp_unknown00000" }, SPOTS)).toBe("sp_unknown00000");
        expect(itemLabel({ kind: "location", slug: "%E3%83%91%E3%83%AA" }, SPOTS)).toBe("パリ");
        expect(itemLabel({ kind: "location", slug: "%" }, SPOTS), "壊れた % は素のまま").toBe("%");
    });
});
