import { describe, it, expect } from "vitest";
import {
    getLocalized,
    getLocalizedParagraphs,
    generateMapLinksFromCoords,
    getPreferredMapLink,
    makeGoogleSearch,
    makeOSM,
    BASE_PHOTOS,
} from "../photos";
import type { Photo } from "../photos";

describe("getLocalized", () => {
    it("文字列をそのまま返す", () => {
        expect(getLocalized("海", "ja")).toBe("海");
    });

    it("locale に応じたテキストを返す", () => {
        expect(getLocalized({ ja: "海", en: "Sea" }, "ja")).toBe("海");
        expect(getLocalized({ ja: "海", en: "Sea" }, "en")).toBe("Sea");
    });

    it("指定 locale がなければ ja にフォールバック", () => {
        expect(getLocalized({ ja: "海" }, "en")).toBe("海");
    });

    it("undefined は空文字を返す", () => {
        expect(getLocalized(undefined, "ja")).toBe("");
    });
});

describe("getLocalizedParagraphs", () => {
    it("文字列を 1 要素の配列で返す", () => {
        expect(getLocalizedParagraphs("テスト", "ja")).toEqual(["テスト"]);
    });

    it("段落配列を locale に応じて返す", () => {
        expect(getLocalizedParagraphs({ ja: ["段落1", "段落2"], en: ["p1", "p2"] }, "ja")).toEqual(["段落1", "段落2"]);
        expect(getLocalizedParagraphs({ ja: ["段落1", "段落2"], en: ["p1", "p2"] }, "en")).toEqual(["p1", "p2"]);
    });

    it("undefined は空配列を返す", () => {
        expect(getLocalizedParagraphs(undefined, "ja")).toEqual([]);
    });
});

/**
 * **打った改行が画面に出ること。**
 *
 * 読む側（写真ページ・モーダル）は段落ごとに `<p>` を出すので、改行が
 * 1エントリの中に残っていると**HTML が空白に潰して消える**。
 * 保存する3経路のうち改行を割っているのは `/admin/edit` だけで、
 * `/user/upload` は必ず素の文字列、`/user/edit` は英語を持つ写真だけ割る。
 *
 * **実データ（`app/data/photos.json` の30枚）で4枚がこの形**だった
 * （サグラダ・ファミリア／ヴァンドーム広場／森の呼吸／石のディテールと光の諧調）。
 */
describe("getLocalizedParagraphs: 改行は段落の区切り", () => {
    it("文字列の改行で割る（/user/upload が保存する形）", () => {
        expect(getLocalizedParagraphs("一行目\n二行目", "ja")).toEqual(["一行目", "二行目"]);
    });

    // ⚠️ 実データ4枚がこの形。**入口を直しても既に保存済みの分は直らない**
    it("段落配列の1エントリに入った改行でも割る", () => {
        expect(getLocalizedParagraphs({ ja: ["サグラダ・ファミリア。\n幻想的な空間。\n記録に残しました。"], en: [] }, "ja"))
            .toEqual(["サグラダ・ファミリア。", "幻想的な空間。", "記録に残しました。"]);
    });

    it("既に割れている段落はそのまま（実データ26枚を壊さない）", () => {
        expect(getLocalizedParagraphs({ ja: ["段落1", "段落2"] }, "ja")).toEqual(["段落1", "段落2"]);
    });

    it("空行は段落にしない（<p></p> を並べない）", () => {
        expect(getLocalizedParagraphs("一行目\n\n\n二行目", "ja")).toEqual(["一行目", "二行目"]);
    });

    // Windows の改行。`trim()` が末尾の \r を落とすので別扱いにしない
    it("CRLF でも割れ、行末に \\r が残らない", () => {
        expect(getLocalizedParagraphs("一行目\r\n二行目", "ja")).toEqual(["一行目", "二行目"]);
    });

    it("英語側も同じ規則", () => {
        expect(getLocalizedParagraphs({ ja: ["日本語"], en: ["First.\nSecond."] }, "en"))
            .toEqual(["First.", "Second."]);
    });

    // 割ったあとも「無ければ次の言語へ」は変えない（`pick` の判断）
    it("英語が空配列なら日本語に落ちる（割っても変わらない）", () => {
        expect(getLocalizedParagraphs({ ja: ["一行目\n二行目"], en: [] }, "en")).toEqual(["一行目", "二行目"]);
    });
});

describe("generateMapLinksFromCoords", () => {
    const basePhoto: Photo = { id: "test", src: "test.jpg" };

    it("coords がない場合 undefined を返す（mapLinks もなし）", () => {
        expect(generateMapLinksFromCoords(basePhoto)).toBeUndefined();
    });

    it("coords から google と osm リンクを生成する", () => {
        const photo: Photo = { ...basePhoto, coords: { lat: 35.681, lng: 139.767 } };
        const result = generateMapLinksFromCoords(photo);
        expect(result?.google).toContain("35.681");
        expect(result?.google).toContain("139.767");
        expect(result?.osm).toContain("35.681");
        expect(result?.osm).toContain("139.767");
    });

    it("既存の mapLinks.google は上書きしない", () => {
        const photo: Photo = {
            ...basePhoto,
            coords: { lat: 35.681, lng: 139.767 },
            mapLinks: { google: "https://custom-link.example.com" },
        };
        const result = generateMapLinksFromCoords(photo);
        expect(result?.google).toBe("https://custom-link.example.com");
        expect(result?.osm).toContain("openstreetmap");
    });

    // **地名から引いたおおよその座標（`geoApprox`）からはリンクを作らない。**
    // 撮影地マップの材料として、地名しか無い写真に街の中心の座標を補う
    // （`scripts/geocode-locations.js`）。その座標で「地図で見る」を出すと、
    // 街の中心に立つピンが「ここで撮った」と読まれる。
    // 写真ページとモーダルは `getPreferredMapLink` 経由でここに来るので、
    // 呼び出し側の分岐ではなくここで止める（片方だけ直すと対が割れる）
    it("おおよその座標（geoApprox）からはリンクを作らない", () => {
        const photo: Photo = { ...basePhoto, coords: { lat: 48.86, lng: 2.35 }, geoApprox: true };
        expect(generateMapLinksFromCoords(photo)).toBeUndefined();
        expect(getPreferredMapLink(photo)).toBeUndefined();
    });

    it("おおよその座標でも、人が付けた mapLinks はそのまま通す", () => {
        const photo: Photo = {
            ...basePhoto,
            coords: { lat: 48.86, lng: 2.35 },
            geoApprox: true,
            mapLinks: { osm: "https://www.openstreetmap.org/#map=15/48.86/2.35" },
        };
        expect(generateMapLinksFromCoords(photo)).toEqual({ osm: "https://www.openstreetmap.org/#map=15/48.86/2.35" });
        // 座標から google を**補完しない**
        expect(getPreferredMapLink(photo)).toEqual({ href: "https://www.openstreetmap.org/#map=15/48.86/2.35", provider: "osm" });
    });

    it("正確な座標（geoApprox なし）は従来どおりリンクを作る", () => {
        const photo: Photo = { ...basePhoto, coords: { lat: 35.68, lng: 139.77 } };
        expect(getPreferredMapLink(photo)?.provider).toBe("google");
    });
});

describe("makeGoogleSearch / makeOSM", () => {
    it("makeGoogleSearch が正しい URL を返す", () => {
        const url = makeGoogleSearch(35.681, 139.767);
        expect(url).toContain("google.com/maps");
        expect(url).toContain("35.681");
    });

    it("makeOSM が正しい URL を返す", () => {
        const url = makeOSM(35.681, 139.767);
        expect(url).toContain("openstreetmap.org");
        expect(url).toContain("35.681");
    });
});

describe("BASE_PHOTOS", () => {
    it("全エントリに id と src がある", () => {
        BASE_PHOTOS.forEach((p) => {
            expect(p.id, `id が必要: ${JSON.stringify(p)}`).toBeTruthy();
            expect(p.src, `src が必要 (id=${p.id})`).toBeTruthy();
        });
    });

    it("id が重複していない", () => {
        const ids = BASE_PHOTOS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("published が false のものは含まれる（フィルタは呼び出し側の責務）", () => {
        // published フラグの有無だけ確認（true/false どちらも valid）
        BASE_PHOTOS.forEach((p) => {
            if (p.published !== undefined) {
                expect(typeof p.published).toBe("boolean");
            }
        });
    });
});
