import { describe, it, expect } from "vitest";
import { planMove, isNoop, PUBLIC_PREFIX, PRIVATE_PREFIX } from "../privateMove";
import { MEDIA_FIELDS } from "../mediaKeys";

const CDN = "https://d1s3dwwzgxf5ni.cloudfront.net";
const U = "22222222-2222-2222-2222-222222222222";

describe("絞った写真の実体を private/ へ移す（案A）", () => {
    const full = () => ({
        id: "p1", userId: U, title: "題",
        key: `uploads/${U}/p1.jpg`,
        src: `${CDN}/uploads/${U}/p1.jpg`,
        srcOriginal: `${CDN}/uploads/${U}/p1-orig.jpg`,
        srcAvif: `${CDN}/uploads/${U}/p1.avif`,
        src256: `${CDN}/uploads/${U}/p1-256.jpg`,
        thumbSrc: `${CDN}/uploads/${U}/p1-t.jpg`,
        thumbSm: `${CDN}/uploads/${U}/p1-sm.jpg`,
        thumbAvif: `${CDN}/uploads/${U}/p1-t.avif`,
        thumbSmAvif: `${CDN}/uploads/${U}/p1-sm.avif`,
    });

    it("🔴 **派生も原本も全部動かす**（src だけでは窓が開いたまま）", () => {
        const plan = planMove(full(), true);
        // 9項目あるが `key` と `src` は**同じ実体**を指すので、動かすのは8つ
        expect(plan.moves).toHaveLength(MEDIA_FIELDS.length - 1);
        for (const field of MEDIA_FIELDS) {
            const value = String(plan.rewritten[field]);
            // `key` は生キー（`private/…`）、URL は `/private/…`。どちらも
            // **`uploads/` は1文字も残さない**
            expect(value, field).toContain("private/");
            expect(value, field).not.toContain("uploads/");
        }
        // **原本（GPS 入り）も置いていかない**
        expect(plan.moves.some((m) => m.from.includes("p1-orig"))).toBe(true);
    });

    it("ホストは変えない（CloudFront のまま）", () => {
        const plan = planMove(full(), true);
        expect(String(plan.rewritten.src)).toBe(`${CDN}/private/${U}/p1.jpg`);
    });

    it("生キー（`key`）は生キーのまま書き換える", () => {
        const plan = planMove(full(), true);
        expect(plan.rewritten.key).toBe(`private/${U}/p1.jpg`);
    });

    // 🔴 `extraImages` は**オブジェクトの配列**。平らな配列で書き戻すと
    // 形が壊れて2枚目以降が全部消える（最初そう書いて、ここで捕まえた）
    it("2枚目以降も動かす。**形は壊さない**", () => {
        const plan = planMove({
            ...full(),
            extraImages: [
                { src: `${CDN}/uploads/${U}/p2.jpg`, thumbSrc: `${CDN}/uploads/${U}/p2-t.jpg`,
                  width: 1200, height: 800 },
                { src: `${CDN}/uploads/${U}/p3.jpg`, width: 640, height: 480 },
            ],
        }, true);
        const extras = plan.rewritten.extraImages as Record<string, unknown>[];
        expect(extras).toHaveLength(2);
        expect(extras[0].src).toBe(`${CDN}/private/${U}/p2.jpg`);
        expect(extras[0].thumbSrc).toBe(`${CDN}/private/${U}/p2-t.jpg`);
        // **URL でない項目は触らない**（形が保たれている）
        expect(extras[0].width).toBe(1200);
        expect(extras[1].height).toBe(480);
        for (const name of ["p2.jpg", "p2-t.jpg", "p3.jpg"]) {
            expect(plan.moves.some((m) => m.from.endsWith(name)), name).toBe(true);
        }
    });

    it("解除したら、逆へ戻す", () => {
        const restricted = planMove(full(), true).rewritten;
        const back = planMove({ ...full(), ...restricted }, false);
        expect(String(back.rewritten.src)).toBe(`${CDN}/uploads/${U}/p1.jpg`);
        expect(back.moves.every((m) => m.to.startsWith(PUBLIC_PREFIX))).toBe(true);
    });

    it("もう向こう側に在るなら、何もしない（二度押しで壊れない）", () => {
        const restricted = { ...full(), ...planMove(full(), true).rewritten };
        expect(isNoop(planMove(restricted, true))).toBe(true);
    });

    it("同じ実体を2度動かさない（重複を畳む）", () => {
        const plan = planMove({
            id: "p1", src: `${CDN}/uploads/${U}/same.jpg`, thumbSrc: `${CDN}/uploads/${U}/same.jpg`,
        }, true);
        expect(plan.moves).toHaveLength(1);
    });

    // `mediaKeys` と同じ線に揃える（あちらの注記が両方の挙動を説明している）:
    // **生キーの `..` は拒否**、URL は `new URL` が畳んでから判定する
    it("`..` の扱いを `mediaKeys` と揃える", () => {
        // 生キー: 畳む主体がいないので拒否
        expect(isNoop(planMove({ key: `uploads/${U}/../x.jpg` }, true))).toBe(true);
        // URL: 解決済みのパスで判定（`/uploads/other/x.jpg` になる）
        const plan = planMove({ src: `${CDN}/uploads/${U}/../other/x.jpg` }, true);
        expect(plan.moves).toEqual([{ from: "uploads/other/x.jpg", to: "private/other/x.jpg" }]);
    });

    it("`uploads/` の外は触らない（`profiles/` など）", () => {
        expect(isNoop(planMove({ src: `${CDN}/profiles/${U}` }, true))).toBe(true);
    });

    it("画像でない項目は書き換えない", () => {
        const plan = planMove(full(), true);
        expect("title" in plan.rewritten).toBe(false);
        expect("id" in plan.rewritten).toBe(false);
        expect("userId" in plan.rewritten).toBe(false);
    });

    it("接頭辞は2つだけ", () => {
        expect(PUBLIC_PREFIX).toBe("uploads/");
        expect(PRIVATE_PREFIX).toBe("private/");
    });
});
