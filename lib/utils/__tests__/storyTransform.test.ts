import { describe, it, expect } from "vitest";
import {
    angleDeg, distance, grabHandle, handleMove, snapRotate,
    stepSize,
    ROTATE_SNAP_DEG, ROTATE_SNAP_TARGETS, SIZE_STEP_RATIO,
} from "../storyTransform";
import { STORY_SIZE_MIN, STORY_SIZE_MAX, STORY_SIZE_DEFAULT } from "../storyText";

/**
 * 角のハンドルで「拡大縮小・回転」する計算。
 *
 * 画面の座標系（**y が下向き**）なので、時計回りが正。ここを取り違えると
 * 指の動きと文字の回り方が逆になり、**触った人には直しようが無い**。
 */
describe("角度と距離", () => {
    it("時計回りが正（画面の座標系・y は下向き）", () => {
        // 中心 (0,0) から見て…
        expect(angleDeg(0, 0, 1, 0)).toBe(0);      // 右
        expect(angleDeg(0, 0, 0, 1)).toBe(90);     // 下（y が下向き＝時計回り）
        expect(angleDeg(0, 0, -1, 0)).toBe(180);   // 左
        expect(angleDeg(0, 0, 0, -1)).toBe(-90);   // 上
    });

    it("距離はふつうの直線距離", () => {
        expect(distance(0, 0, 3, 4)).toBe(5);
        expect(distance(1, 1, 1, 1)).toBe(0);
    });
});

describe("ハンドルを掴む", () => {
    it("掴んだ時点の角度・距離・姿を控える", () => {
        const g = grabHandle(100, 100, 130, 140, 10, 0.08);
        expect(g.angle).toBeCloseTo(angleDeg(100, 100, 130, 140), 6);
        expect(g.dist).toBeCloseTo(50, 6);
        expect(g.rotate).toBe(10);
        expect(g.size).toBe(0.08);
    });

    /**
     * **距離を 0 にしない。**
     *
     * 中心をそのまま掴むと距離 0 になり、あとで比を取ると Infinity / NaN。
     * そのまま `size` に入ると**文字が消える**（描けない大きさになる）。
     */
    it("中心をそのまま掴んでも、距離が 0 にならない", () => {
        const g = grabHandle(100, 100, 100, 100, 0, 0.08);
        expect(g.dist).toBe(1);
        const moved = handleMove(g, 150, 100);
        expect(Number.isFinite(moved.size), "size が有限でない").toBe(true);
        expect(moved.size).toBeLessThanOrEqual(STORY_SIZE_MAX);
    });
});

describe("ハンドルを動かす", () => {
    // 中心 (0,0)・右へ 100px の点を掴む（角度 0・距離 100）
    const grab = () => grabHandle(0, 0, 100, 0, 0, STORY_SIZE_DEFAULT);

    it("指の角度の差がそのまま傾きになる", () => {
        // 真下へ回す＝ +90 度
        expect(handleMove(grab(), 0, 100).rotate).toBe(90);
        // 真上へ回す＝ −90 度
        expect(handleMove(grab(), 0, -100).rotate).toBe(-90);
    });

    // **角のどこを掴んでも同じに動く**（掴んだ点との差だけを見るので、
    // ハンドルの位置を知らなくてよい）
    it("掴んだ場所が違っても、同じだけ回せば同じ傾きになる", () => {
        const a = handleMove(grabHandle(0, 0, 100, 0, 0, 0.08), 0, 100);       // 0° → 90°
        const b = handleMove(grabHandle(0, 0, 0, 100, 0, 0.08), -100, 0);      // 90° → 180°
        expect(a.rotate).toBe(b.rotate);
    });

    it("掴んだ時点の傾きに足す（0 から数え直さない）", () => {
        const g = grabHandle(0, 0, 100, 0, 30, 0.08);
        expect(handleMove(g, 0, 100).rotate).toBe(120);   // 30 + 90
    });

    /**
     * **大きさは掛け算。**
     *
     * 引き算にすると、小さい文字は同じ指の動きで一気に巨大になる
     * （比率が揃わない）。距離が2倍なら大きさも2倍。
     */
    it("中心からの距離の比が、そのまま大きさの比になる", () => {
        // **範囲の内側で見る。** 0.05 を半分にすると 0.025 で、
        // `STORY_SIZE_MIN`（0.03）に切り上げられる——比ではなく
        // 挟み込みを見てしまう（最初にそう書いて落ちた）
        const g = grabHandle(0, 0, 100, 0, 0, 0.07);
        expect(handleMove(g, 200, 0).size).toBeCloseTo(0.14, 3);
        expect(handleMove(g, 50, 0).size).toBeCloseTo(0.035, 3);
    });

    it("大きさは範囲の中に収まる", () => {
        const g = grabHandle(0, 0, 100, 0, 0, STORY_SIZE_DEFAULT);
        expect(handleMove(g, 100000, 0).size).toBe(STORY_SIZE_MAX);
        expect(handleMove(g, 1, 0).size).toBe(STORY_SIZE_MIN);
    });

    /**
     * **差分を積まない。**
     *
     * 1フレームごとの差を積むと、丸め（傾きは1度・大きさは小数3桁）の
     * 誤差が積み上がり、**ゆっくり回すと速く回すより少なく動く**。
     * 掴んだ時点からの差で決めているので、途中経路に依らない。
     */
    it("途中でどう動かしても、同じ場所に来れば同じ姿になる", () => {
        const g = grabHandle(0, 0, 100, 0, 0, 0.06);
        const direct = handleMove(g, 0, 100);
        // ぐるぐる経由してから同じ点へ
        for (const [x, y] of [[70, 70], [0, 100], [-70, 70], [-100, 0], [0, -100], [100, 0]]) {
            handleMove(g, x, y);
        }
        const viaPath = handleMove(g, 0, 100);
        expect(viaPath).toEqual(direct);
    });
});

/**
 * **まっすぐに戻せるようにする。**
 *
 * 指で 0 度ちょうどに合わせるのはまず無理で、±2度 の傾きは
 * 「曲がっている」としか見えない。吸い付きが無いと「回せるが、戻せない」。
 */
describe("直角への吸い付き", () => {
    it("直角の近くは吸い付く", () => {
        for (const t of ROTATE_SNAP_TARGETS) {
            expect(snapRotate(t + ROTATE_SNAP_DEG - 1)).toBe(snapRotate(t));
            expect(snapRotate(t - ROTATE_SNAP_DEG + 1)).toBe(snapRotate(t));
        }
    });

    // **広げすぎない。** 広いと狙った傾きにできなくなる
    it("離れていれば吸い付かない", () => {
        expect(snapRotate(ROTATE_SNAP_DEG + 1)).toBe(ROTATE_SNAP_DEG + 1);
        expect(snapRotate(45)).toBe(45);
        expect(snapRotate(30)).toBe(30);
    });

    // −180 と 180 は同じ向き。畳んだあとの値で揃える
    it("吸い付いた先も −180〜180 に畳まれている", () => {
        for (const v of [179, -179, 181, -181]) {
            const got = snapRotate(v);
            expect(got).toBeGreaterThanOrEqual(-180);
            expect(got).toBeLessThanOrEqual(180);
        }
    });
});

describe("キーボードでの拡大縮小", () => {
    it("掛け算で変える（指と同じ理由）", () => {
        expect(stepSize(0.05, 1)).toBeCloseTo(0.05 * SIZE_STEP_RATIO, 3);
        expect(stepSize(0.05, -1)).toBeCloseTo(0.05 / SIZE_STEP_RATIO, 3);
    });

    it("範囲の外へ出ない", () => {
        expect(stepSize(STORY_SIZE_MAX, 1)).toBe(STORY_SIZE_MAX);
        expect(stepSize(STORY_SIZE_MIN, -1)).toBe(STORY_SIZE_MIN);
    });

    // **端まで渡れること。** 刻みが細かすぎると、端に着く前に人が諦める
    it("最小から最大まで、30回以内で渡れる", () => {
        let s = STORY_SIZE_MIN;
        let n = 0;
        while (s < STORY_SIZE_MAX && n < 100) { s = stepSize(s, 1); n++; }
        expect(s).toBe(STORY_SIZE_MAX);
        expect(n).toBeLessThanOrEqual(30);
    });

});
