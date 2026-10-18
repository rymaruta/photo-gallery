import { describe, it, expect } from "vitest";
import { displayTitle, photoOwnTitle, fallbackPhotoTitle, photoTitleFor } from "../photoTitle";

// owner:「タイトルに無題と入ってしまう。一覧を見たときに無題ではなくて、
// タイトルなくてもいいよ」。**「無題」は表示の落とし先ではなく、サーバーが
// 保存していた実データ**なので、保存をやめても既存の写真には残る。出す側でも落とす
describe("displayTitle", () => {
    it("サーバーが入れていた「無題」/ Untitled は題として扱わない", () => {
        expect(displayTitle("無題")).toBe("");
        expect(displayTitle("Untitled")).toBe("");
        expect(displayTitle("  無題  "), "前後の空白で素通りする").toBe("");
    });

    it("題が無いときは空", () => {
        expect(displayTitle(undefined)).toBe("");
        expect(displayTitle("")).toBe("");
        expect(displayTitle("   ")).toBe("");
    });

    it("本物の題はそのまま（前後の空白だけ落とす）", () => {
        expect(displayTitle("白波の夏")).toBe("白波の夏");
        expect(displayTitle("  リアス海岸 ")).toBe("リアス海岸");
        // **部分一致で落とさない**——「無題の風景」は利用者が名付けた題
        expect(displayTitle("無題の風景"), "本物の題を落としている").toBe("無題の風景");
        expect(displayTitle("Untitled Symphony")).toBe("Untitled Symphony");
    });
});

// 検索結果・SNS・RSS・構造化データ・共有に出す題（2026-10-18）。
// owner:「撮影地を使って『板橋区の写真』のように出す」
describe("photoTitleFor（必ず空でない題）", () => {
    it("題があればその題（撮影地から作っていない）", () => {
        expect(photoTitleFor({ title: { ja: "朝の湖" }, location: "板橋区" }, "ja")).toEqual({ text: "朝の湖", fromTitle: true });
        expect(photoTitleFor({ title: "朝の湖" }, "ja")).toEqual({ text: "朝の湖", fromTitle: true });
    });

    it("題が無い・空白だけ・{ ja: 無題, en: Untitled } → 「<撮影地>の写真」", () => {
        for (const title of [undefined, "", "   ", { ja: "無題", en: "Untitled" }, { ja: "  " }, "無題"]) {
            expect(photoTitleFor({ title, location: " 板橋区 " }, "ja"), JSON.stringify(title)).toEqual({ text: "板橋区の写真", fromTitle: false });
            expect(photoTitleFor({ title, location: "板橋区" }, "en").text).toBe("Photo taken in 板橋区");
        }
    });

    it("撮影地も無ければ「写真」/ Photo", () => {
        expect(photoTitleFor({ title: { ja: "無題" } }, "ja").text).toBe("写真");
        expect(photoTitleFor({ title: undefined, location: "  " }, "ja").text).toBe("写真");
        expect(photoTitleFor({}, "en").text).toBe("Photo");
        expect(photoTitleFor(null, "ja").text).toBe("写真");
    });

    it("「無題」の言語を飛ばして、もう一方の本物の題を使う", () => {
        expect(photoOwnTitle({ title: { ja: "無題", en: "Sunset" } }, "ja")).toBe("Sunset");
        expect(photoOwnTitle({ title: { ja: "夕焼け", en: "Sunset" } }, "en")).toBe("Sunset");
        expect(photoOwnTitle({ title: { ja: "夕焼け", en: "" } }, "en")).toBe("夕焼け");
    });

    it("代わりの題の言い方は写真ページの見出しと同じ", () => {
        expect(fallbackPhotoTitle("板橋区, 日本", "ja")).toBe("板橋区の写真");
        expect(fallbackPhotoTitle(undefined, "ja")).toBe("写真");
        expect(fallbackPhotoTitle(42, "en"), "文字列でない撮影地は無いのと同じ").toBe("Photo");
    });
});

// 撮影地は最初の区切りまで（2026-10-18・本番で「板橋区, 日本の写真」になっていた）。
// 切り方はホームのタイルの撮影地（`shortPlace`）と同じ
describe("代わりの題の撮影地は先頭だけ", () => {
    it.each([
        ["板橋区, 日本", "板橋区の写真", "Photo taken in 板橋区"],
        ["京都、日本", "京都の写真", "Photo taken in 京都"],
        ["東京，日本", "東京の写真", "Photo taken in 東京"],
        ["Itabashi, Tokyo, Japan", "Itabashiの写真", "Photo taken in Itabashi"],
        ["  山中湖  ", "山中湖の写真", "Photo taken in 山中湖"],
        // 区切りの前が空なら丸ごと（「の写真」だけにしない）
        [", 日本", ", 日本の写真", "Photo taken in , 日本"],
    ])("%s → %s / %s", (loc, ja, en) => {
        expect(fallbackPhotoTitle(loc, "ja")).toBe(ja);
        expect(fallbackPhotoTitle(loc, "en")).toBe(en);
        expect(photoTitleFor({ title: { ja: "無題", en: "Untitled" }, location: loc }, "ja").text).toBe(ja);
    });
});
