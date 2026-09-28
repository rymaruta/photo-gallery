import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
// **上限は定数から導く**（文言の中の数字を手書きすると、上限を動かすたびに
// テストを実装に合わせて直すことになる。実際 100 → 1000 でここが落ちた）
import { PHOTO_LIMIT_PER_USER } from "../../../../lib/utils/uploadLimits";
import userEvent from "@testing-library/user-event";

// **入力候補（前に使った撮影地・カテゴリ）を見るテストが1本も無かった。**
// `setOwnValues(collectOwnValues(all))` を丸ごと消しても
// `app/user/upload` の8ファイル43件が全緑だった（実測）。
// 隣の編集画面（`app/user/edit`）には同じ形のテストがある。
// 候補が出ないと、同じ場所が別々の名前に散る（「パリ」「パリ, フランス」…）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
// **言語を切り替えられる形にする。** 固定だと「言語も見る」と書いた
// `aria-label` の英語側を誰も通らない（日本語固定に戻す変異が素通りした）
const uiLocale = vi.hoisted(() => ({ value: "ja" as "ja" | "en" }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: uiLocale.value }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 受け皿は開けたが中身が無い（＝共有経由ではない通常の表示）
    readSharedResult: vi.fn(async () => ({ ok: true, payload: null })),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error { },
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

// 「パリ」2枚・「京都」1枚（下書きも混ぜる。候補は公開状態に関係なく出す）
const PHOTOS = [
    // **タグは英語で保存しておく**（実データ30枚がそう）。決まった選択肢は
    // 日本語なので、寄らなければチップが光らない——そこを画面で見る
    { id: "p1", src: "s", userId: "me", location: "パリ", category: "風景", tags: ["sunset"] },
    { id: "p2", src: "s", userId: "me", location: "パリ", category: "風景", tags: ["sunset", "桜"] },
    { id: "p3", src: "s", userId: "me", location: "京都", category: "街", published: false },
];

const optionValues = (id: string) =>
    Array.from(document.querySelectorAll(`#${id} option`)).map((o) => (o as HTMLOptionElement).value);

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => PHOTOS });
});

/** 共通設定（＝候補の datalist）は写真を選んでから出る */
async function pickOne() {
    const { container } = render(<UploadPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByText(/全写真に適用/);
}


/**
 * 欄の文字列ではなく、**保存されるタグ**で見る。
 *
 * チップを押すと末尾に区切りが残る（そのまま打つと前のタグに繋がるため）。
 * 生の文字列で比べると、この表示上の違いで落ちて、**守りたい性質**
 * （押したら入る／打ちかけがタグとして残らない）が見えなくなる。
 */
const savedTags = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

describe("アップロード画面の入力候補", () => {
    it("前に使った撮影地を、よく使う順に候補へ出す", async () => {
        await pickOne();
        await waitFor(() => expect(optionValues("own-locations").length).toBeGreaterThan(0));
        expect(optionValues("own-locations"), "候補が出ていない／並びが違う").toEqual(["パリ", "京都"]);
    });

    it("下書きのカテゴリも候補に入る（公開状態は関係ない）", async () => {
        await pickOne();
        await waitFor(() => expect(optionValues("own-categories").length).toBeGreaterThan(0));
        expect(optionValues("own-categories")).toContain("街");
    });

    // **タグは datalist が効かない**（欄全体を置き換えるのでカンマ区切りが
    // 壊れる）ので、押して足せるチップにしてある。**押して本当に入るかを
    // 見るテストが、この画面には1本も無かった**——`/user/edit` にはあった。
    // owner の「自分で入力するのではなく決まったのを選ぶ方が楽？」に
    // 答えるには、grep ではなく実際に押して確かめる必要がある
    it("タグは押して足せる（カンマ区切りを壊さない）", async () => {
        await pickOne();
        const chip = await screen.findByRole("switch", { name: "#夕焼け" });
        await userEvent.click(chip);
        const field = screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;
        expect(savedTags(field.value), "押しても欄に入っていない").toEqual(["夕焼け"]);
        // 2つ目を足しても1つ目が消えない（datalist にできない理由そのもの）
        await userEvent.click(await screen.findByRole("switch", { name: "#桜" }));
        expect(savedTags(field.value), "前に足したタグが消えている").toEqual(["夕焼け", "桜"]);
    });

    // **押し直したら外れる。** もとは足すだけだったので、既に付いている
    // タグのチップは**押しても何も起きなかった**（見た目も変わらないので
    // 押せていないのかも分からない）。一覧の絞り込みは前から押し直して
    // 外す形で、投稿・編集の候補チップだけ古いままだった
    it("押し直したら外れる（選んだかどうかも分かる）", async () => {
        await pickOne();
        const chip = await screen.findByRole("switch", { name: "#夕焼け" });
        const field = screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;
        expect(chip, "まだ選んでいないのに選択済みに見える").toHaveAttribute("aria-checked", "false");

        await userEvent.click(chip);
        expect(savedTags(field.value)).toEqual(["夕焼け"]);
        expect(chip, "選んだことが分からない").toHaveAttribute("aria-checked", "true");
        // **見た目でも分かること。** 直した症状の見出しは「選んだかどうかが
        // 分からない」＝見た目の話なので、`aria-checked` だけでは足りない
        // （選択中の色を未選択と同じに戻す変異が素通りしていた）
        expect(chip.className, "選択中の見た目になっていない").toContain("bg-primary ");
        expect(chip.className, "白い塗りの上の文字が墨になっていない").toContain("text-ink ");

        await userEvent.click(chip);
        expect(field.value, "押し直しても外れない（押しても何も起きないボタン）").toBe("");
        expect(chip).toHaveAttribute("aria-checked", "false");
        expect(chip.className, "外したのに選択中の見た目のまま").not.toContain("bg-primary");
    });

    // 手で打った綴りが違っても、同じタグとして見る（二重に入れない）
    it("手で打ったタグも、同じものなら選択済みとして扱う", async () => {
        await pickOne();
        const field = screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;
        await userEvent.type(field, "#夕焼け");
        const chip = await screen.findByRole("switch", { name: "#夕焼け" });
        expect(chip, "同じタグなのに未選択に見える").toHaveAttribute("aria-checked", "true");
        await userEvent.click(chip);
        expect(field.value, "同じタグが2つ入った").toBe("");
    });

    // **宣言した順**（`TAG_CHOICES`）。候補が固定になったので、選ぶたびに
    // 並びが動かない——動く入力は押し間違える。並びが崩れると、いちばん押す
    // ものが12個の枠から落ちる
    it("タグの候補は、決まった順に並ぶ（選んでも動かない）", async () => {
        await pickOne();
        const chips = await screen.findAllByRole("switch", { name: /^#(夕焼け|桜)$/ });
        expect(chips.map((c) => c.textContent), "よく使う順になっていない").toEqual(["#夕焼け", "#桜"]);
    });

    // **読めない行が混じっても候補は出す**（1件の巻き添えで全部を失わない）。
    // 枠の数え方は別: `countUserPhotos` は `Select: "COUNT"` なので、
    // 落とした行も上限に数える（「あと3枚」と出て 403 にしない）
    it("読めない行が混じっても、残りから候補を作る", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => [...PHOTOS, null, { src: "id無し" }] });
        await pickOne();
        await waitFor(() => expect(optionValues("own-locations").length).toBeGreaterThan(0));
        expect(optionValues("own-locations")).toEqual(["パリ", "京都"]);
        // PHOTOS の3件 + 読めない2行 = サーバーは5件と数える
        const used = PHOTOS.length + 2;
        expect(screen.getByText(`あと${PHOTO_LIMIT_PER_USER - used}枚アップロードできます（${PHOTO_LIMIT_PER_USER}枚まで）`),
            "落とした行を枠から引いている（サーバーは数える）").toBeInTheDocument();
    });

    // **候補のまとまりに名前を付ける。** 読み上げは「夜景 スイッチ オン」としか
    // 言わないので、何のスイッチか分からない（`role="switch"` にしたぶん、
    // ただのボタンだった頃より「何の」が要る）
    it("候補のまとまりに名前がある", async () => {
        await pickOne();
        expect(screen.getByRole("group", { name: "タグの候補" }), "何のスイッチか分からない").toBeInTheDocument();
    });

    // **打ちかけの文字で候補を絞る。** 選択肢は20語あるので、
    // 打った文字で当たりを出せると押すまでが速い
    it("打ちかけの文字で候補を絞る", async () => {
        await pickOne();
        const field = screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;
        expect(await screen.findByRole("switch", { name: "#桜" })).toBeInTheDocument();

        // **「夕」で絞る。**「夜」は選択肢そのものなので打ちかけにならない
        // （丸ごと一致＝選び終えた1つ、と見て絞りを解く）
        await userEvent.type(field, "夕");
        expect(screen.getByRole("switch", { name: "#夕焼け" })).toBeInTheDocument();
        expect(screen.queryByRole("switch", { name: "#桜" }), "絞れていない").toBeNull();

        // **最後のカンマから後ろで絞る**（前に入れたタグに引きずられない）
        await userEvent.clear(field);
        await userEvent.type(field, "夕焼け, 桜x");
        expect(screen.queryByRole("switch", { name: "#夕焼け" }), "前のタグで絞っている").toBeNull();
        expect(screen.queryByRole("switch", { name: "#桜" }), "打ちかけに当たらない候補が残っている").toBeNull();

        // **打ち終わったら絞りを解く**（1つ選んだら、続けて2つ目を選べる）
        await userEvent.clear(field);
        await userEvent.type(field, "夕焼け");
        expect(screen.getByRole("switch", { name: "#桜" }), "1つ選んだら他が選べない").toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "#夕焼け" })).toHaveAttribute("aria-checked", "true");

        // 一致が無ければ候補そのものを出さない（関係ないものを並べない）
        await userEvent.clear(field);
        await userEvent.type(field, "zzz");
        expect(screen.queryByRole("group", { name: "タグの候補" }), "関係ない候補が残っている").toBeNull();
    });

    it("英語UIでは候補のまとまりの名前も英語", async () => {
        uiLocale.value = "en";
        try {
            // `pickOne` は日本語の見出しを待つので、ここは英語側の見出しで待つ
            const { container } = render(<UploadPage />);
            const input = container.querySelector('input[type="file"]') as HTMLInputElement;
            await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
            await screen.findByText(/applied to all photos/i);
            expect(screen.getByRole("group", { name: "Tag choices" }), "日本語のまま出している").toBeInTheDocument();
        } finally {
            uiLocale.value = "ja";
        }
    });

    // **打って絞って押したら、打ちかけの文字が残ってはいけない。**
    // 絞りを入れた最初の版は `"夕"` と打って `夕焼け` を押すと `"夕, 夕焼け"` になり、
    // **`夕` がそのまま写真のタグとして保存された**（絞りの目的は
    // 「打つから表記が割れる」を減らすことなのに、逆に綴りを増やしていた）。
    // 単体だけだと、画面が欠片を落としていない変異が素通りする
    it("打って絞って押すと、欄には選んだタグだけが入る", async () => {
        await pickOne();
        const field = screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;

        await userEvent.type(field, "夕");
        await userEvent.click(await screen.findByRole("switch", { name: "#夕焼け" }));
        expect(savedTags(field.value), "打ちかけの文字がタグとして残っている").toEqual(["夕焼け"]);

        // 前に選んだタグは残る（落とすのは**最後の欠片だけ**）
        await userEvent.clear(field);
        await userEvent.type(field, "桜, 夕");
        await userEvent.click(await screen.findByRole("switch", { name: "#夕焼け" }));
        expect(savedTags(field.value), "前に選んだタグまで落としている").toEqual(["桜", "夕焼け"]);
    });
});
