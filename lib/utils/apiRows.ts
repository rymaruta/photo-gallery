import { log } from "./log";

/**
 * 応答の配列から、**描画できない行だけを落とす**。
 *
 * これまでは `Array.isArray(data)` までしか見ずに、そのまま状態へ入れていた。
 * 中身は描画の途中で読むので、**100件中1件が `null` なだけでページ全体が
 * `ErrorBoundary` のカードに置き換わる**——ヘッダーもフッターもトーストも
 * 消える（実測で確認）。通知ベルはレイアウトに常駐しているので、
 * そこが落ちると**どのページを開いてもカードになる**。
 *
 * 直し方は「1件の巻き添えで全部を失わない」——落とすのは読めない行だけ。
 *
 * **黙って落とさない。** 何件落としたかは開発者向けのログに出す
 * （利用者の名前や本文は出さない。過去に診断ログへ表示名を全部書き出した
 * 事故があるため、**件数だけ**にする）。
 *
 * @returns 配列でなければ `null`（呼び出し側が「取れなかった」と扱えるように）
 */
export function usableRows<T>(data: unknown, label: string): T[] | null {
    if (!Array.isArray(data)) return null;
    const rows = data.filter((row): row is T =>
        typeof row === "object" && row !== null && !Array.isArray(row));
    if (rows.length !== data.length) {
        log.warn(`${label}: 読めない行を落としました`, { dropped: data.length - rows.length, total: data.length });
    }
    return rows;
}

/**
 * 写真の配列。`id` が文字列であることまで見る。
 *
 * `id` は React のキーであり、写真の突き合わせ（`find(p => p.id === photoId)`・
 * お気に入り・関連写真）の唯一の手がかり。無い行を通すと、
 * 「一覧には出るのに開けない」写真ができる。
 */
export function usablePhotoRows<T extends { id?: unknown; tags?: unknown }>(data: unknown, label: string): T[] | null {
    const rows = usableRows<T>(data, label);
    if (!rows) return null;
    const withId = rows.filter((row) => typeof row.id === "string" && row.id);
    if (withId.length !== rows.length) {
        log.warn(`${label}: id の無い行を落としました`, { dropped: rows.length - withId.length, total: rows.length });
    }
    // **`tags` が配列でない行は、写真ごと捨てずに `tags` だけ捨てる。**
    //
    // 描画側は `(p.tags ?? []).map(...)`（`useGallery`）と、**配列である
    // ことを構造として当てにしている**（`?? []` は `null` は拾うが、
    // 文字列やオブジェクトはそのまま `.map` へ行く）。
    // 文字列が入っていると `.map is not a function` でページ全体が落ちる
    // （テストで実際に再現した）。ただし写真そのものは表示できるので、
    // 巻き添えにするのは行き過ぎ——おかしいのはタグの欄だけ。
    let fixed = 0;
    const out = withId.map((row) => {
        if (row.tags === undefined || Array.isArray(row.tags)) return row;
        fixed++;
        return { ...row, tags: [] };
    });
    if (fixed > 0) log.warn(`${label}: tags が配列でない行を直しました`, { fixed, total: out.length });
    return out;
}
