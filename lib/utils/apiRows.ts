import { log } from "./log";

/**
 * 応答の配列から、**描画できない行だけを落とす**。
 *
 * これまでは `Array.isArray(data)` までしか見ずに、そのまま状態へ入れていた。
 * 中身は描画の途中で読むので、**100件中1件が `null` なだけでページ全体が
 * `ErrorBoundary` のカードに置き換わる**——ヘッダーもフッターもトーストも
 * 消える（実測で確認）。通知ベルはレイアウトに常駐しているので、
 * **開いたあとは**どのページでもカードになる（60秒ごとに取り直すので
 * 「再試行」も効かない）。ただし `items` を読むのはベルを**開いている間
 * だけ**なので、開かなければ落ちない。
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

/**
 * 応答の本体が「オブジェクト1つ」であることを確かめる。
 *
 * 一覧と違い、`/profile/<id>` のような**1件だけの応答**は
 * 「1件の巻き添えで全部を失う」型ではない——ここで見たいのは
 * **`as UserProfile` が何も確かめていない**こと。本文が `null` の 200 は
 * そのまま状態へ入り、「取得できた（＝未設定の人）」として扱われて
 * 失敗が伝わらなかった。
 *
 * @returns オブジェクト以外（`null`・配列・スカラ）は `null`
 */
export function usableObject<T>(data: unknown, label: string): T | null {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        log.warn(`${label}: 応答がオブジェクトではありません`, {
            type: data === null ? "null" : Array.isArray(data) ? "array" : typeof data,
        });
        return null;
    }
    return data as T;
}

/**
 * 画面に出す文字列の項目。
 *
 * **オブジェクト・配列は落とす。** React の子に渡すと
 * 「Objects are not valid as a React child」で投げ、`ErrorBoundary` の
 * カードがページを覆う（実測で確認）。
 *
 * 数値・真偽値は `String()` で受ける——このリポジトリの他の受け口
 * （写真のタイトルなど）と同じ扱いで、**出せるものを落とさない**。
 */
export function displayString(v: unknown): string | undefined {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return undefined;
}

/** 文字列の配列。配列でなければ `undefined`、要素は文字列だけ残す */
export function stringList(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    return v.filter((x): x is string => typeof x === "string");
}
