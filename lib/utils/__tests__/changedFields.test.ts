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
