// lib/utils/storyTransform.ts
// ストーリーの文字を「角のハンドルで拡大縮小・回転する」ための計算。純関数だけ。

import { clampStoryTextSize, normalizeStoryRotate } from "./storyText";

/**
 * **写しの2本（`storyText.ts`）には入れない。**
 *
 * あちらは `api-user/src/storyText.ts` と**1バイト単位で一致**させることを
 * テストで縛ってある（`storyTextParity.test.ts`）。ここに在るのは
 * **画面で指を追うための計算**で、サーバーは一度も使わない——入れると
 * サーバー側の束も同じだけ太り、片方だけ直せない制約が無関係なコードにも
 * 掛かる。保存される値の形（`rotate` とその畳み方）だけがあちらの仕事。
 */

/** 角度（度）。画面の座標系（y が下向き）で、**時計回りが正** */
export function angleDeg(cx: number, cy: number, px: number, py: number): number {
    return (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
}

/** 2点の距離 */
export function distance(cx: number, cy: number, px: number, py: number): number {
    return Math.hypot(px - cx, py - cy);
}

/**
 * ハンドルを掴んだ瞬間に控えるもの。
 *
 * **掴んだ時点の姿を覚えて、そこからの差で決める。** 1フレームごとの
 * 差分を積むと、丸め（`rotate` は1度・`size` は小数3桁）の誤差が
 * **積み上がって**、ゆっくり回すと速く回すより少なく動く、という形になる。
 */
export type HandleGrab = {
    /** 文字の中心（画面の座標・px） */
    cx: number;
    cy: number;
    /** 掴んだ点の、中心から見た角度と距離 */
    angle: number;
    dist: number;
    /** 掴んだ時点の姿 */
    rotate: number;
    size: number;
};

export function grabHandle(
    cx: number, cy: number, px: number, py: number,
    rotate: number, size: number,
): HandleGrab {
    return {
        cx, cy,
        angle: angleDeg(cx, cy, px, py),
        // **0 にしない。** 中心をそのまま掴むと距離 0 で、あとで割ると
        // Infinity / NaN になる（そのまま `size` に入れると文字が消える）。
        // 1px 未満は「中心を掴んだ」とみなして 1 に倒す
        dist: Math.max(1, distance(cx, cy, px, py)),
        rotate,
        size,
    };
}

/**
 * **まっすぐに戻せるようにする。**
 *
 * 指で 0 度ちょうどに合わせるのはまず無理で、`±2度` の傾きは
 * 「曲がっている」としか見えない。直角の近くに来たら吸い付かせる。
 *
 * ⚠️ **これは見た目の足し算ではなく、操作の欠陥を塞ぐもの。**
 * 吸い付きが無いと「回せるが、戻せない」になる。
 */
export const ROTATE_SNAP_TARGETS = [-180, -90, 0, 90, 180] as const;
/** 吸い付く幅（度）。広げすぎると、狙った傾きにできなくなる */
export const ROTATE_SNAP_DEG = 4;

export function snapRotate(deg: number): number {
    const d = normalizeStoryRotate(deg);
    for (const t of ROTATE_SNAP_TARGETS) {
        if (Math.abs(d - t) <= ROTATE_SNAP_DEG) return normalizeStoryRotate(t);
    }
    return d;
}

/**
 * ハンドルを動かした先の姿。
 *
 * - **傾き**は、掴んだ点との角度の差をそのまま足す（掴んだ場所が指の下から
 *   ずれない）。**角のどこを掴んでも同じ**に動くので、ハンドルの位置を
 *   知らなくてよい
 * - **大きさ**は、中心からの距離の比を掛ける。掛け算にするのは、
 *   小さい文字と大きい文字で「同じだけ指を動かしたときの変化」を
 *   揃えるため（引き算だと、小さい文字は一気に巨大になる）
 *
 * どちらも**掴んだ時点の姿からの差**で決める（`HandleGrab` の説明）。
 */
export function handleMove(
    grab: HandleGrab, px: number, py: number,
): { rotate: number; size: number } {
    const angle = angleDeg(grab.cx, grab.cy, px, py);
    const dist = Math.max(1, distance(grab.cx, grab.cy, px, py));
    return {
        rotate: snapRotate(grab.rotate + (angle - grab.angle)),
        size: clampStoryTextSize(grab.size * (dist / grab.dist)),
    };
}

/**
 * キーボードでの回転。**指でなぞれない人の唯一の回し方。**
 *
 * 矢印キーが「動かす」に割り当て済み（`StoryTextOverlay`）なので、
 * 回すのは別のキーにする。1回で 5度、`Shift` で 15度
 * （1周を 72 回／24 回。端まで押し続けずに済む刻み）。
 */
export const ROTATE_STEP_DEG = 5;
export const ROTATE_STEP_DEG_COARSE = 15;

/**
 * キーボードでの拡大縮小。**掛け算で変える**（指と同じ理由）。
 * 1回で 8%（`STORY_SIZE_MIN`→`MAX` をおよそ 22 回で渡れる刻み）。
 */
export const SIZE_STEP_RATIO = 1.08;

export function stepSize(size: number, direction: 1 | -1): number {
    const next = direction > 0 ? size * SIZE_STEP_RATIO : size / SIZE_STEP_RATIO;
    return clampStoryTextSize(next);
}

/**
 * **ハンドルの位置は計算しない。**
 *
 * ここに「回したあとの角の座標」を出す関数を置いていたが、**使わずに済んだ**
 * ので消した。ハンドルを**回った箱の子**として置けば CSS が一緒に回すので、
 * 角度の式を持つ必要が無い。置いていたら、同じ角度の式が
 * **描く側とここ**の2か所に在ることになっていた——このリポジトリが
 * 何度も踏んでいる「規則を2か所に書く」型。
 */
