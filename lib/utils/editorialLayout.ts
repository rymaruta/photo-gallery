/**
 * ホームの写真の並び（iOS の `EditorialLayout`・板 01c と同じ規則）。
 *
 * **大きく1枚 → 2枚 → 2枚** の繰り返し（5枚でひと回り）。写真の縦横比は使わない
 * ——位置で決まるリズムなので、読み込んでから高さが変わって画面が跳ねることがない。
 *
 *     ┌───────────────┐   0 … 大きく1枚（16:9）
 *     ├───────┬───────┤   1,2 … 2枚ずつ（1:1）
 *     ├───────┼───────┤   3,4
 *     └───────┴───────┘
 *
 * **端数で崩さない。** 2枚の段に相方がいなければ、その1枚だけで横いっぱいの段にする
 * （半分だけ写真がある段を作らない）。
 */
export type EditorialRow<T> =
    | { kind: "hero"; item: T }
    | { kind: "pair"; items: [T, T] };

export function editorialRows<T>(items: readonly T[]): EditorialRow<T>[] {
    const rows: EditorialRow<T>[] = [];
    // 何段目か（iOS と同じく「3段でひと回り」を段の数で数える）
    let slot = 0;
    for (let i = 0; i < items.length; slot++) {
        if (slot % 3 === 0) {
            rows.push({ kind: "hero", item: items[i] });
            i += 1;
            continue;
        }
        const first = items[i];
        const second = items[i + 1];
        if (second === undefined) {
            rows.push({ kind: "hero", item: first });
            i += 1;
        } else {
            rows.push({ kind: "pair", items: [first, second] });
            i += 2;
        }
    }
    return rows;
}

/**
 * 写真に重ねる撮影地の短い名前（iOS の `HomeTileText.place`）。**最初の区切りまで**
 * （「パリ, フランス」→「パリ」）。無ければ空。
 */
export function shortPlace(location: string | null | undefined): string {
    const trimmed = (location ?? "").trim();
    const head = trimmed.split(/[,、，]/)[0] ?? trimmed;
    return head.trim();
}
