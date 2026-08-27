import { describe, it, expect } from "vitest";
import { sameFieldValue, changedFields } from "../changedFields";

// 写真の編集は「開いた時点の全項目」を毎回送っていた。サーバーは部分更新
// なのに全部送れば全置換と同じで、2タブで開いて片方を直したあと
// もう片方で保存すると先の編集が消えた（写真の更新には rev が無い）。

describe("sameFieldValue", () => {
    it("空文字・undefined・null は同じ（触っていない項目をクリア扱いしない）", () => {
        expect(sameFieldValue("", undefined)).toBe(true);
        expect(sameFieldValue(undefined, null)).toBe(true);
        expect(sameFieldValue("", "")).toBe(true);
    });

    it("値が入っていたものを空にするのは差分（クリアの意思は伝える）", () => {
        expect(sameFieldValue("", "山中湖")).toBe(false);
    });

    it("配列・オブジェクトは中身で比べる", () => {
        expect(sameFieldValue(["雪", "山"], ["雪", "山"])).toBe(true);
        expect(sameFieldValue(["雪"], ["雪", "山"])).toBe(false);
        expect(sameFieldValue({ ja: "湖", en: "Lake" }, { ja: "湖", en: "Lake" })).toBe(true);
        expect(sameFieldValue({ ja: "湖" }, { ja: "海" })).toBe(false);
    });
});

describe("changedFields", () => {
    it("変わった項目だけを返す", () => {
        const prev = { title: "湖", location: "山中湖", tags: ["雪"], category: "風景" };
        const next = { title: "夕焼けの湖", location: "山中湖", tags: ["雪"], category: "風景" };
        expect(changedFields(next, prev)).toEqual({ title: "夕焼けの湖" });
    });

    it("何も変えていなければ空（＝サーバーは1項目も触らない）", () => {
        const same = { title: "湖", location: "山中湖", date: "", tags: [] as string[] };
        expect(changedFields(same, { ...same, date: undefined })).toEqual({});
    });
});

// 以下はレビューが「実装が落ちる条件を1本も踏んでいない」と指摘した形。
// 実データ（app/data/photos.json）は title 28/30・description 30/30 が
// **{en, ja} 順**で保存されている一方、画面が組む値は {ja, en} 順。
// JSON 文字列で比べていた頃は、この2項目が毎回「変わった」と判定され、
// 差分送信が主役の項目で何も効いていなかった。
describe("sameFieldValue: 実データで起きる形", () => {
    it("キーの順番が違っても同じ（DDB を通ると順番は変わる）", () => {
        expect(sameFieldValue({ ja: "湖", en: "Lake" }, { en: "Lake", ja: "湖" })).toBe(true);
        expect(sameFieldValue({ ja: ["静か"], en: ["Quiet"] }, { en: ["Quiet"], ja: ["静か"] })).toBe(true);
    });

    it("空の入れ物と「属性なし」は同じ（消す指定を飛ばさない）", () => {
        // 説明も EXIF も無い写真を保存するたびに REMOVE が飛び、
        // 別タブで書いた説明を消していた
        expect(sameFieldValue({ ja: [], en: [] }, undefined)).toBe(true);
        expect(sameFieldValue({}, undefined)).toBe(true);
        expect(sameFieldValue([], undefined)).toBe(true);
    });

    it("サーバーが落とした空の en と、画面が付ける en:'' は同じ", () => {
        // sanitizeTitle は空の en をキーごと落として保存する
        expect(sameFieldValue({ ja: "湖", en: "" }, { ja: "湖" })).toBe(true);
    });

    it("中身が変わっていれば、キー順が違っても差分として検出する", () => {
        expect(sameFieldValue({ ja: "海", en: "Lake" }, { en: "Lake", ja: "湖" })).toBe(false);
        expect(sameFieldValue({ ja: ["書いた"], en: [] }, undefined)).toBe(false);
        expect(sameFieldValue({ camera: "X-T5" }, {})).toBe(false);
    });
});
