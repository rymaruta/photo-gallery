// ミニプレイヤーの自由配置（デスクトップ）で使う位置クランプ。
//
// 不変条件（メニューバーを塞がないための核心・回帰テストで固定）:
//   - box の上端 y は必ず「ヘッダー高さ headerH」以上（＝ヘッダー帯＝メニューボタンに侵入しない）
//   - box は必ず画面内（x ∈ [0, vw-w], y ∈ [headerH, vh-h]）
// これを純関数として切り出し、MiniPlayer の restore/resize/onPointerMove から使う。

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Viewport = { vw: number; vh: number };

/**
 * ミニプレイヤーの位置を、ヘッダー帯を避けつつ画面内へクランプする。
 * @param pos      希望位置（box 左上）
 * @param size     box の実寸
 * @param viewport ビューポート
 * @param headerH  ヘッダー高さ（この値未満の y は許可しない）
 */
export function clampMiniPlayerPos(pos: Point, size: Size, viewport: Viewport, headerH: number): Point {
    // 数値でない入力は 0 とみなして安全側に倒す
    const num = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);
    const w = Math.max(0, num(size.w));
    const h = Math.max(0, num(size.h));
    const vw = Math.max(0, num(viewport.vw));
    const vh = Math.max(0, num(viewport.vh));
    const top = Math.max(0, num(headerH));

    // 横: [0, vw - w]。box が画面より広い場合は 0 に寄せる。
    const maxX = Math.max(0, vw - w);
    const x = Math.min(Math.max(0, num(pos.x)), maxX);

    // 縦: [top, vh - h]。ヘッダー帯を必ず避ける。
    // box が入りきらない狭い画面では下限（top）を優先し、ヘッダーには絶対に被せない。
    const maxY = Math.max(top, vh - h);
    const y = Math.min(Math.max(top, num(pos.y)), maxY);

    return { x, y };
}
