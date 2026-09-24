import { describe, it, expect } from "vitest";
import {
    COLOR_BUCKETS,
    MIN_PHOTOS_PER_COLOR,
    parseHexColor,
    rgbToHsl,
    colorBucketOf,
    photoColorBucket,
    groupPhotosByColor,
    visibleColorBuckets,
} from "../buckets";

/** 本番の公開写真39枚が実際に持っている `dominantColor`（2026-09-21 実測）。
 *  **作り話の色で数えない**——この機能が何件発火するかは、この値でしか測れない。 */
const LIVE_DOMINANT_COLORS = [
    "#787878", "#4878a8", "#c8c8b8", "#080808", "#080808", "#181818", "#283838",
    "#e8e8f8", "#282828", "#181818", "#282818", "#f8f8f8", "#586878", "#6888a8",
    "#081818", "#180808", "#181818", "#181818", "#080808", "#b88848", "#4888a8",
    "#083888", "#080808", "#181808", "#080808", "#080808", "#783808", "#383828",
    "#485868", "#080808", "#887868", "#383838", "#284888", "#182828", "#383838",
    "#3878b8", "#080808", "#081828", "#485868",
];

describe("COLOR_BUCKETS（チップの表）", () => {
    it("owner が挙げた10色がこの順で並んでいる", () => {
        expect(COLOR_BUCKETS.map((b) => b.label)).toEqual(
            ["青", "緑", "赤", "橙", "黄", "桃", "紫", "白", "黒", "モノクロ"],
        );
    });
    it("id が重複していない", () => {
        const ids = COLOR_BUCKETS.map((b) => b.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
    it("目印の色は #rrggbb", () => {
        for (const b of COLOR_BUCKETS) {
            expect(b.swatch, `${b.id} の swatch`).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });
});

describe("parseHexColor", () => {
    it("#rrggbb を読む", () => {
        expect(parseHexColor("#4878a8")).toEqual({ r: 0x48, g: 0x78, b: 0xa8 });
    });
    it("大文字でも読む", () => {
        expect(parseHexColor("#AABBCC")).toEqual({ r: 170, g: 187, b: 204 });
    });
    it.each(["4878a8", "#4878a", "#4878a88", "#abc", "red", "", "#gggggg", "#4878a8 "])(
        "形が違う %s は null",
        (v) => expect(parseHexColor(v)).toBeNull(),
    );
});

describe("rgbToHsl", () => {
    it("真っ黒は彩度も明度も0", () => {
        expect(rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
    });
    it("真っ白は明度1・彩度0", () => {
        expect(rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 1 });
    });
    it("灰色は彩度0（明度が中央でも分母が0にならない）", () => {
        const { s, l } = rgbToHsl(128, 128, 128);
        expect(s).toBe(0);
        expect(l).toBeCloseTo(0.502, 2);
    });
    it.each([
        ["赤", 255, 0, 0, 0],
        ["黄", 255, 255, 0, 60],
        ["緑", 0, 255, 0, 120],
        ["シアン", 0, 255, 255, 180],
        ["青", 0, 0, 255, 240],
        ["マゼンタ", 255, 0, 255, 300],
    ])("%s の色相が %d 度", (_n, r, g, b, h) => {
        expect(rgbToHsl(r as number, g as number, b as number).h).toBeCloseTo(h as number, 5);
    });
    it("どの入力でも彩度・明度が 0〜1 に収まる", () => {
        for (let i = 0; i < 256; i += 17) {
            for (let j = 0; j < 256; j += 17) {
                const { s, l } = rgbToHsl(i, j, 255 - i);
                expect(Number.isFinite(s), `s が有限でない (${i},${j})`).toBe(true);
                expect(s).toBeGreaterThanOrEqual(0);
                expect(s).toBeLessThanOrEqual(1);
                expect(l).toBeGreaterThanOrEqual(0);
                expect(l).toBeLessThanOrEqual(1);
            }
        }
    });
});

describe("colorBucketOf", () => {
    it.each([
        ["#ff0000", "red"],
        ["#ff8800", "orange"],
        ["#ffee00", "yellow"],
        ["#00ff00", "green"],
        ["#0000ff", "blue"],
        ["#8800ff", "purple"],
        ["#ff00cc", "pink"],
    ])("鮮やかな %s は %s", (hex, id) => {
        expect(colorBucketOf(hex as string)).toBe(id);
    });

    it("0度をまたぐ色相は赤に戻る（350度）", () => {
        expect(colorBucketOf("#ff0033")).toBe("red");
    });

    it.each([
        ["#000000", "black"],
        ["#111111", "black"],
        ["#808080", "mono"],
        ["#ffffff", "white"],
        ["#f8f8f8", "white"],
    ])("無彩色の %s は %s", (hex, id) => {
        expect(colorBucketOf(hex as string)).toBe(id);
    });

    /**
     * **これがこの分け方の肝。** 彩度を先に見るので、「暗いが青い」写真が
     * 黒に吸われない。明度で先に切る版だと `#081828` は黒になり、
     * 本番39枚のうち青が10枚まで減る（実測）。
     */
    it("暗くても色が付いていれば色の側へ行く", () => {
        expect(colorBucketOf("#081828"), "暗い青（明度 0.094）").toBe("blue");
        expect(colorBucketOf("#301010"), "暗い赤（明度 0.125）").toBe("red");
    });

    /**
     * **ほぼ真っ黒の枠は、色味があっても黒。** HSL の彩度は明度が 0 に近いほど
     * 跳ね上がる——`#180808` は明度 0.063 なのに彩度 0.50。彩度だけを見ると
     * 「赤」になる（レビューで指摘され、本番の3枚がそうなっていた）。
     */
    it.each(["#180808", "#081818", "#181808", "#080810"])("明度 0.08 未満の %s は黒", (hex) => {
        expect(colorBucketOf(hex)).toBe("black");
    });

    it("彩度がごく低ければ、暗さに応じて黒・モノクロ・白", () => {
        expect(colorBucketOf("#181818")).toBe("black");
        expect(colorBucketOf("#787878")).toBe("mono");
        expect(colorBucketOf("#f8f8f8")).toBe("white");
    });

    it("形が違う色は null（既定のチップに落とさない）", () => {
        expect(colorBucketOf("red")).toBeNull();
        expect(colorBucketOf("")).toBeNull();
        expect(colorBucketOf("#abc")).toBeNull();
    });

    it("返る id は必ず表に在るもの", () => {
        const known = new Set(COLOR_BUCKETS.map((b) => b.id));
        for (const hex of LIVE_DOMINANT_COLORS) {
            const id = colorBucketOf(hex);
            expect(id, `${hex} が読めない`).not.toBeNull();
            expect(known.has(id!), `${hex} → ${id} が表に無い`).toBe(true);
        }
    });
});

describe("photoColorBucket", () => {
    it("dominantColor を読む", () => {
        expect(photoColorBucket({ dominantColor: "#3878b8" })).toBe("blue");
    });
    /**
     * **手元の断面（`app/data/photos.json`）は30枚すべてが色を持たない。**
     * ここで既定を返すと、全部が同じチップに入って「色でさがす」が嘘になる。
     */
    it("dominantColor が無ければ null", () => {
        expect(photoColorBucket({})).toBeNull();
        expect(photoColorBucket({ dominantColor: undefined })).toBeNull();
    });
    it("文字列でない値でも落ちない", () => {
        expect(photoColorBucket({ dominantColor: 123 as unknown as string })).toBeNull();
        expect(photoColorBucket({ dominantColor: null as unknown as string })).toBeNull();
    });
});

describe("groupPhotosByColor", () => {
    it("色ごとに分ける", () => {
        const g = groupPhotosByColor([
            { dominantColor: "#0000ff" },
            { dominantColor: "#000000" },
            { dominantColor: "#0000ee" },
        ]);
        expect(g.get("blue")).toHaveLength(2);
        expect(g.get("black")).toHaveLength(1);
    });
    it("色を持たない写真は数えない", () => {
        const g = groupPhotosByColor([{}, { dominantColor: "#0000ff" }, { dominantColor: "壊れた" }]);
        expect([...g.values()].flat()).toHaveLength(1);
    });
    it("渡された並び順を保つ", () => {
        const g = groupPhotosByColor([
            { dominantColor: "#0000ff", id: "a" },
            { dominantColor: "#0000ee", id: "b" },
        ] as { dominantColor: string; id: string }[]);
        expect(g.get("blue")!.map((p) => p.id)).toEqual(["a", "b"]);
    });
    it("空の配列でも落ちない", () => {
        expect(groupPhotosByColor([]).size).toBe(0);
    });
});

describe("visibleColorBuckets", () => {
    it("最小枚数に満たない色は出さない", () => {
        const out = visibleColorBuckets([{ dominantColor: "#0000ff" }]);
        expect(out).toHaveLength(0);
    });
    it("最小枚数に達したら出す", () => {
        const out = visibleColorBuckets([{ dominantColor: "#0000ff" }, { dominantColor: "#0000ee" }]);
        expect(out.map((x) => x.bucket.id)).toEqual(["blue"]);
    });
    it("COLOR_BUCKETS の順で返る（枚数順に並べ替えない）", () => {
        const photos = [
            ...Array(5).fill({ dominantColor: "#000000" }),   // black（表では9番目）
            ...Array(2).fill({ dominantColor: "#0000ff" }),   // blue（表では1番目）
        ];
        expect(visibleColorBuckets(photos).map((x) => x.bucket.id)).toEqual(["blue", "black"]);
    });
    it("色を1枚も持たない一覧では空（手元の断面がこれ）", () => {
        expect(visibleColorBuckets([{}, {}, {}])).toHaveLength(0);
    });
});

/**
 * **本番の実データで何件発火するか。** この機能を作ってよいかの根拠そのもの
 * なので、数値ごと固定する。ここが変わったら、作った前提が変わったということ。
 */
describe("本番39枚（実測値）での発火数", () => {
    const photos = LIVE_DOMINANT_COLORS.map((dominantColor) => ({ dominantColor }));

    it("39枚すべてが色として読める", () => {
        expect(photos.filter((p) => photoColorBucket(p) !== null)).toHaveLength(39);
    });

    it("内訳が実測どおり（青13 黒16 黄3 橙3 モノクロ3 白1）", () => {
        const g = groupPhotosByColor(photos);
        expect(Object.fromEntries([...g].map(([k, v]) => [k, v.length]))).toEqual({
            blue: 13, black: 16, yellow: 3, orange: 3, mono: 3, white: 1,
        });
    });

    it("2枚以上あるのは5色で、38/39 枚が拾われる", () => {
        const out = visibleColorBuckets(photos);
        expect(out.map((x) => x.bucket.id)).toEqual(["blue", "orange", "yellow", "black", "mono"]);
        expect(out.reduce((n, x) => n + x.photos.length, 0)).toBe(38);
    });

    /**
     * **分かっている限界を、消えないように書き留める。**
     * `dominantColor` は「いちばん多い1ビン」＝たいてい影の色なので、
     * 葉や草が主役でも緑にならない。`blurDataURL` の分布なら7枚立つところまで
     * 確かめたが、閾値を検証する術が無いので採っていない（`buckets.ts` 冒頭）。
     */
    it("緑・赤・桃・紫は本番で0枚（dominantColor の限界。直すなら別の値を見る）", () => {
        const g = groupPhotosByColor(photos);
        expect(g.get("green")).toBeUndefined();
        expect(g.get("red")).toBeUndefined();
        expect(g.get("pink")).toBeUndefined();
        expect(g.get("purple")).toBeUndefined();
    });

    it("最小枚数は2（撮影地の線と同じ。広げるとこのテストが落ちる）", () => {
        expect(MIN_PHOTOS_PER_COLOR).toBe(2);
    });
});

/**
 * **色の決め方を差し替える口（`bucketOf`）。**
 *
 * 画面は `useBlurColors` が決めたぶんだけ差し替えて渡す——`dominantColor` は
 * 「いちばん多い1ビン＝たいてい影」で、本番39枚のうち**21枚で中身と
 * 食い違っていた**（実測 2026-09-24）。差し替えが本当に効くこと、
 * **渡さなければ今までどおり**であることの両方を縛る。
 */
describe("色の決め方の差し替え", () => {
    // `dominantColor` は黒、差し替えでは橙——**どちらが使われたかが結果で分かる**
    const SHADOWY = [
        { id: "a", dominantColor: "#080808" },
        { id: "b", dominantColor: "#181818" },
    ];
    const asOrange = () => "orange";

    it("渡さなければ `dominantColor`（今までどおり）", () => {
        expect(groupPhotosByColor(SHADOWY).get("black")).toHaveLength(2);
        expect(visibleColorBuckets(SHADOWY).map((x) => x.bucket.id)).toEqual(["black"]);
    });
    it("渡せばそちらで仕分ける", () => {
        expect(groupPhotosByColor(SHADOWY, asOrange).get("orange")).toHaveLength(2);
        expect(groupPhotosByColor(SHADOWY, asOrange).has("black")).toBe(false);
    });
    it("`visibleColorBuckets` も同じ口を下へ渡す", () => {
        const out = visibleColorBuckets(SHADOWY, asOrange);
        expect(out.map((x) => x.bucket.id)).toEqual(["orange"]);
        expect(out[0].photos.map((p) => p.id)).toEqual(["a", "b"]);
    });
    it("差し替えが `null` を返した写真は、今までどおり落ちる", () => {
        const only = (p: { id: string }) => (p.id === "a" ? "orange" : null);
        expect(groupPhotosByColor(SHADOWY, only).get("orange")).toHaveLength(1);
        expect(groupPhotosByColor(SHADOWY, only).size).toBe(1);
    });
    it("最小枚数の線は差し替えても同じ（1枚のチップは出ない）", () => {
        const one = (p: { id: string }) => (p.id === "a" ? "orange" : "blue");
        expect(visibleColorBuckets(SHADOWY, one)).toHaveLength(0);
    });
});
