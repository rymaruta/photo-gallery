import { describe, it, expect } from "vitest";
import {
    normalizeDigits, numericClaims, articleHasNumber, placeNames, regionNames,
    subjectNames, sameSubject, checkSpot,
} from "../check-spot-wikipedia.mjs";

/**
 * **撮影スポットの下書きを Wikipedia と突き合わせる道具**の判定を、固定データで縛る。
 * 記事の本文は CC BY-SA でリポジトリに入れないので、ここは短い作り物の文で試す。
 */

describe("数の読み取り", () => {
    it("🔴 桁区切りの後ろに単位が続いても区切りを外す（実測: 明石海峡大橋の 3,911m を 911m と読んでいた）", () => {
        expect(normalizeDigits("全長3,911mの吊橋")).toBe("全長3911mの吊橋");
        expect(numericClaims("全長3,911mの吊橋").map((c) => c.value)).toEqual(["3911"]);
    });
    it("全角の数字を半角にする", () => {
        expect(normalizeDigits("標高１２３４ｍ")).toBe("標高1234ｍ");
    });
    it("高さ・距離・年・段・本を拾い、10未満と月・時刻は拾わない", () => {
        const claims = numericClaims("標高848m、398段の石段、1959年建立、2本の滝。4月上旬が見頃で、6時に開門。").map((c) => c.raw);
        expect(claims).toEqual(["848m", "398段", "1959年"]);
    });
    it("同じ数は1つにまとめる", () => {
        expect(numericClaims("高さ40m。落差40mの滝")).toHaveLength(1);
    });
});

describe("記事に数があるか", () => {
    it("桁区切りや単位の書き方が違っても当たる", () => {
        expect(articleHasNumber("全長3,911メートル", "3911")).toBe(true);
    });
    it("🔴 別の数の一部には当てない（300 が 1300 や 300.5 に当たらない）", () => {
        expect(articleHasNumber("標高1300メートル", "300")).toBe(false);
        expect(articleHasNumber("300.5メートル", "300")).toBe(false);
        expect(articleHasNumber("標高300メートル", "300")).toBe(true);
    });
});

describe("場所の名前", () => {
    it("郡を外し、市町村の字を外した形も探す", () => {
        expect(placeNames("西臼杵郡高千穂町")).toEqual(["西臼杵郡高千穂町", "高千穂町", "高千穂"]);
        expect(placeNames(undefined)).toEqual([]);
    });
    it("県は `県` を外した形も・海外は国名", () => {
        expect(regionNames({ country: "日本", prefecture: "香川県" })).toEqual(["香川県", "香川"]);
        expect(regionNames({ country: "日本", prefecture: "北海道" })).toEqual(["北海道"]);
        expect(regionNames({ country: "フランス" })).toEqual(["フランス"]);
    });
});

describe("記事がそのスポットそのものか", () => {
    it("名前の最後の語と括弧の中の呼び名で比べる", () => {
        expect(subjectNames("利尻島 姫沼")).toEqual(["姫沼"]);
        expect(subjectNames("オペラ・ガルニエ（パレ・ガルニエ）")).toEqual(["オペラガルニエ", "パレガルニエ"]);
    });
    it("題と名前のどちらかがもう一方を含めば同じもの（異体字・「の」も揃える）", () => {
        expect(sameSubject({ name: "眼鏡橋" }, "眼鏡橋 (長崎市)")).toBe(true);
        expect(sameSubject({ name: "柳津 圓蔵寺" }, "円蔵寺")).toBe(true);
        expect(sameSubject({ name: "三保松原" }, "三保の松原")).toBe(true);
    });
    it("🔴 近くの別の施設・関連する別の記事は弾く（実データのずれ）", () => {
        expect(sameSubject({ name: "明石城跡", aliases: ["明石公園"] }, "兵庫県立明石公園第一野球場")).toBe(false);
        // 別名に祭りが入っていても、別名では合わせない
        expect(sameSubject({ name: "櫛田神社", aliases: ["博多祇園山笠"] }, "博多祇園山笠")).toBe(false);
        // 島の記事はビーチの記事ではない
        expect(sameSubject({ name: "座間味島 古座間味ビーチ" }, "座間味島")).toBe(false);
    });
});

describe("1件の判定", () => {
    const spot = {
        name: "高屋神社",
        region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
        summary: "標高404mの稲積山の山頂にある神社。",
        description: "",
        highlights: [],
    };
    const article = { status: "ok", title: "高屋神社", url: "u", revid: 1, text: "香川県観音寺市の稲積山（標高404メートル）の山頂に鎮座する。" };

    it("場所・位置・数が全部合えば match", () => {
        expect(checkSpot(spot, { distanceKm: 0.1 }, article).verdict).toBe("match");
    });
    it("記事が無ければ no-article", () => {
        expect(checkSpot(spot, undefined, undefined).verdict).toBe("no-article");
        expect(checkSpot(spot, undefined, { status: "no-article" }).verdict).toBe("no-article");
    });
    it("🔴 別のものの記事なら、県や数が合っても subject", () => {
        expect(checkSpot(spot, {}, { ...article, title: "観音寺市役所" }).verdict).toBe("subject");
    });
    it("記事に県が出てこなければ place", () => {
        expect(checkSpot(spot, {}, { ...article, text: "標高404メートルの山頂に鎮座する。観音寺" }).verdict).toBe("place");
    });
    it("🔴 台帳の座標が遠ければ、ほかが合っても coords（座標を直すまで出さない）", () => {
        expect(checkSpot(spot, { coordsMismatch: true, distanceKm: 3.4 }, article).verdict).toBe("coords");
    });
    it("記事に出てこない数があれば unsupported（間違いとは決めつけず一覧に出す）", () => {
        const r = checkSpot({ ...spot, summary: "標高405mの山頂" }, {}, article);
        expect(r.verdict).toBe("unsupported");
        expect(r.missing).toEqual(["405m"]);
    });
});
