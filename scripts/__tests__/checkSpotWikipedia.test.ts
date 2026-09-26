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
    const has = (article: string, text: string) => articleHasNumber(article, numericClaims(text)[0]);

    it("桁区切りや単位の書き方が違っても当たる", () => {
        expect(has("全長3,911メートル", "全長3911m")).toBe(true);
        expect(has("延長12㎞", "12km")).toBe(true);
    });
    it("🔴 別の数の一部には当てない（300 が 1300 や 300.5 に当たらない）", () => {
        expect(has("標高1300メートル", "300m")).toBe(false);
        expect(has("標高300.5メートル", "300m")).toBe(false);
        expect(has("標高300メートル", "300m")).toBe(true);
    });
    it("🔴 単位が違えば当てない（実データ: 300本 ← 300円・700段 ← 樹齢700年・12m ← 12日）", () => {
        expect(has("入園料 一般 300円", "300本")).toBe(false);
        expect(has("樹齢は約700年", "700段")).toBe(false);
        expect(has("毎年8月12日に", "12m")).toBe(false);
        expect(has("16時30分まで", "30m")).toBe(false);
    });
    it("🔴 丸めた数は許さない（榛名湖の約1100m が妙義山の 1103メートルに当たっていた）", () => {
        expect(has("妙義山（標高1103メートル）", "1100m")).toBe(false);
        expect(has("1933年に竣工", "1959年")).toBe(false);
    });
    it("🔴 `キロ` 単独・面積の m2 は長さとして読まない", () => {
        expect(numericClaims("重さ20キログラム・出力50キロワット")).toEqual([]);
        expect(has("面積500m2", "500m")).toBe(false);
        expect(has("延長12キロメートル", "12km")).toBe(true);
    });
    it("🔴 年は西暦の4桁だけ（「20年ごと」が「昭和20年」に当たっていた）", () => {
        expect(numericClaims("20年ごとの式年遷宮")).toEqual([]);
        expect(numericClaims("1958年に完成").map((c) => c.value)).toEqual(["1958"]);
    });
});

describe("場所の名前", () => {
    it("郡を外した形も探す。🔴 市町村の字を外した短い形は使わない（`府中` はどこにでも出る）", () => {
        expect(placeNames("西臼杵郡高千穂町")).toEqual(["西臼杵郡高千穂町", "高千穂町"]);
        expect(placeNames("府中市")).toEqual(["府中市"]);
        expect(placeNames(undefined)).toEqual([]);
    });
    it("🔴 県は正式名だけ（`京都` は `東京都` に含まれる）。東京都だけ `東京` も・海外は国名", () => {
        expect(regionNames({ country: "日本", prefecture: "京都府" })).toEqual(["京都府"]);
        expect(regionNames({ country: "日本", prefecture: "東京都" })).toEqual(["東京都", "東京"]);
        expect(regionNames({ country: "日本", prefecture: "北海道" })).toEqual(["北海道"]);
        expect(regionNames({ country: "フランス" })).toEqual(["フランス"]);
    });
});

describe("記事がそのスポットそのものか", () => {
    it("名前の最後の語と括弧の中の呼び名で比べる", () => {
        expect(subjectNames("利尻島 姫沼")).toEqual(["姫沼"]);
        expect(subjectNames("オペラ・ガルニエ（パレ・ガルニエ）")).toEqual(["オペラガルニエ", "パレガルニエ"]);
    });
    it("同じか、名前が題を含めば同じもの（異体字・「の」も揃える）", () => {
        expect(sameSubject({ name: "勝連城跡" }, "勝連城")).toBe(true);
        expect(sameSubject({ name: "史跡足利学校" }, "足利学校")).toBe(true);
        expect(sameSubject({ name: "眼鏡橋" }, "眼鏡橋 (長崎市)")).toBe(true);
        expect(sameSubject({ name: "柳津 圓蔵寺" }, "円蔵寺")).toBe(true);
        expect(sameSubject({ name: "三保松原" }, "三保の松原")).toBe(true);
    });
    it("🔴 近くの別の施設・関連する別の記事は弾く（実データのずれ）", () => {
        expect(sameSubject({ name: "明石城跡", aliases: ["明石公園"] }, "兵庫県立明石公園第一野球場")).toBe(false);
        // 別名に祭りが入っていても、別名では合わせない
        expect(sameSubject({ name: "櫛田神社", aliases: ["博多祇園山笠"] }, "博多祇園山笠")).toBe(false);
        // 🔴 題がスポット名を含む向き（実データの match にあった）
        expect(sameSubject({ name: "神島" }, "鳥羽市立神島中学校")).toBe(false);
        expect(sameSubject({ name: "西海橋" }, "新西海橋")).toBe(false);
        expect(sameSubject({ name: "七里ヶ浜" }, "七里ヶ浜駅")).toBe(false);
        // 🔴 名前が題を含んでも、題が親のことがある（温泉地・山）
        expect(sameSubject({ name: "道後温泉本館" }, "道後温泉")).toBe(false);
        expect(sameSubject({ name: "亀老山展望公園" }, "亀老山")).toBe(false);
        // 島の記事はビーチの記事ではない
        expect(sameSubject({ name: "座間味島 古座間味ビーチ" }, "座間味島")).toBe(false);
    });
});

describe("1件の判定", () => {
    const spot = {
        name: "高屋神社",
        region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
        summary: "標高404mの稲積山の山頂にある神社。1922年に建てた社殿。",
        description: "",
        highlights: [],
    };
    const article = { status: "ok", title: "高屋神社", url: "u", revid: 1, text: "香川県観音寺市の稲積山（標高404メートル）の山頂に鎮座する。社殿は1922年の建立。" };

    it("場所・位置・数が全部合えば match", () => {
        expect(checkSpot(spot, { distanceKm: 0.1 }, article).verdict).toBe("match");
    });
    it("🔴 合った数が1つだけなら match にしない（single。偶然1つ当たることがある）", () => {
        expect(checkSpot({ ...spot, summary: "標高404mの山頂にある神社。" }, {}, article).verdict).toBe("single");
    });
    it("🔴 照らせる数が無ければ match にしない（located。中身は一度も照合していない）", () => {
        expect(checkSpot({ ...spot, summary: "山頂にある神社。" }, {}, article).verdict).toBe("located");
    });
    it("記事が無ければ no-article", () => {
        expect(checkSpot(spot, undefined, undefined).verdict).toBe("no-article");
        expect(checkSpot(spot, undefined, { status: "no-article" }).verdict).toBe("no-article");
    });
    it("🔴 別のものの記事なら、県や数が合っても subject", () => {
        expect(checkSpot(spot, {}, { ...article, title: "観音寺市役所" }).verdict).toBe("subject");
    });
    it("記事に県が出てこなければ place", () => {
        expect(checkSpot(spot, {}, { ...article, text: "標高404メートルの山頂に鎮座する。1922年。観音寺" }).verdict).toBe("place");
    });
    it("🔴 台帳の座標が遠ければ、ほかが合っても coords（座標を直すまで出さない）", () => {
        expect(checkSpot(spot, { coordsMismatch: true, distanceKm: 3.4 }, article).verdict).toBe("coords");
    });
    it("記事に出てこない数があれば unsupported（間違いとは決めつけず一覧に出す）", () => {
        const r = checkSpot({ ...spot, summary: "標高450mの山頂。1922年の社殿" }, {}, article);
        expect(r.verdict).toBe("unsupported");
        expect(r.missing).toEqual(["450m"]);
    });
});
