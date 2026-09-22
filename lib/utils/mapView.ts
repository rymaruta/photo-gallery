/**
 * 撮影地マップ（/map）が「どこを見ているか」の受け渡し。
 *
 * 2つの入口がある:
 * - URL の `#<zoom>/<lat>/<lng>`——写真ページの「撮影地マップで見る」が
 *   その写真の位置へ寄せて開くのに使う。**読むだけ**で、地図を動かしても
 *   URL には書かない（`history.replaceState` で Next の内部キーを潰した
 *   事故があるので、履歴には触らない）
 * - `sessionStorage` の控え——地図を動かすたびに書き、次にこのタブで
 *   開いたとき同じ場所を出す。写真を開いて戻るたびに全体表示へ戻される
 *   のを止める（実測: ズーム 6 まで寄って写真を開き、戻ると 1 に戻っていた）
 *
 * どちらも純関数にしてあるのは、Leaflet を jsdom で動かさずに決め方を
 * テストするため。
 */

export type MapView = { lat: number; lng: number; zoom: number };

/** 一番引けるズーム。世界1周が 1024px になり、スマホの地図の高さ
 *  （70vh ≒ 590px）でも上下に下地が出ない。1 だと 512px で 39px、
 *  0 だと 211px の黒帯が上に出ていた（実測 390x844） */
export const MAP_MIN_ZOOM = 2;
/** タイルの最大ズーム（OSM の標準タイルは 19 まであるが 18 で十分） */
export const MAP_MAX_ZOOM = 18;
/** 写真ページから飛んできたときのズーム。約1km に丸めた座標なので、
 *  これ以上寄ってもピンの位置に意味が無い */
export const PHOTO_LINK_ZOOM = 12;

const LAT_MAX = 85.05112878;   // メルカトルの定義域

/** 控えの鍵（同じタブの中だけ） */
export const MAP_VIEW_KEY = "photo-map:view";

function clampView(v: MapView): MapView | null {
    if (![v.lat, v.lng, v.zoom].every(Number.isFinite)) return null;
    // 経度は世界を跨いだぶんを戻す（`worldCopyJump` で中心が ±180 を越えうる）。
    // 範囲内の値は触らない（剰余を通すと 2.18 が 2.1800000000000637 になる）
    const lng = v.lng >= -180 && v.lng <= 180 ? v.lng : ((((v.lng + 180) % 360) + 360) % 360) - 180;
    return {
        lat: Math.max(-LAT_MAX, Math.min(LAT_MAX, v.lat)),
        lng,
        zoom: Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, v.zoom)),
    };
}

/** `#12/35.42/138.88` の形。小数4桁（約11m）で足りる */
export function formatMapHash(v: MapView): string {
    const c = clampView(v);
    if (!c) return "";
    const n = (x: number) => String(Math.round(x * 1e4) / 1e4);
    return `#${Math.round(c.zoom)}/${n(c.lat)}/${n(c.lng)}`;
}

/** `#12/35.42/138.88` → 見る場所。形が違えば null（他のハッシュは無視） */
export function parseMapHash(hash: string): MapView | null {
    const m = /^#?(\d{1,2})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(hash ?? "");
    if (!m) return null;
    return clampView({ zoom: Number(m[1]), lat: Number(m[2]), lng: Number(m[3]) });
}

export type SavedView = { view: MapView; hash: string };

function getStorage(): Storage | null {
    try {
        return typeof sessionStorage !== "undefined" ? sessionStorage : null;
    } catch {
        return null;
    }
}

/** 控えを読む。無い・壊れている・読めない（プライベートモード等）なら null */
export function readSavedView(storage: Storage | null = getStorage()): SavedView | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(MAP_VIEW_KEY);
        if (!raw) return null;
        const o = JSON.parse(raw) as Record<string, unknown>;
        const view = clampView({ lat: Number(o.lat), lng: Number(o.lng), zoom: Number(o.zoom) });
        if (!view) return null;
        return { view, hash: typeof o.hash === "string" ? o.hash : "" };
    } catch {
        return null;
    }
}

/** 控えを書く。**そのとき URL に付いていたハッシュも一緒に**（下の決め方に要る）。
 *  書けなくても何もしない（控えは便宜で、無くても地図は出る） */
export function saveView(view: MapView, hash: string, storage: Storage | null = getStorage()): void {
    if (!storage) return;
    const c = clampView(view);
    if (!c) return;
    try {
        storage.setItem(MAP_VIEW_KEY, JSON.stringify({ ...c, hash }));
    } catch {
        /* 満杯・禁止。控え無しで進む */
    }
}

/**
 * 控えを**消す**。「現在地」を使った瞬間に呼ぶ。
 *
 * 地図を動かすたびに中心を控えているので、現在地へ寄せたあとに何もしないと
 * **端末のだいたいの位置が sessionStorage に残る**（小数4桁＝約11m）。
 * 写真の座標は約1km に丸めて出しているのに、閲覧者自身の位置だけが
 * それより細かく残るのは筋が通らない。
 *
 * 消すだけでなく、以後この画面では控えを**書かない**（`PhotoMap` 側の
 * `suppressSaveRef`）。「戻ったとき同じ場所を出す」便宜は失うが、
 * 位置を持たない方を選ぶ。
 */
export function clearSavedView(storage: Storage | null = getStorage()): void {
    if (!storage) return;
    try {
        storage.removeItem(MAP_VIEW_KEY);
    } catch {
        /* 読み書きが禁止された環境。控えが無いのと同じ */
    }
}

/**
 * 最初に見せる場所を決める。null なら「全部のピンが収まる範囲」（呼び出し側）。
 *
 * - ハッシュがあり、**それが控えを取ったときのハッシュと違う**なら、
 *   新しく飛んできたのでハッシュの位置
 * - ハッシュが控えと同じなら、写真を開いて戻ってきたところ。
 *   飛んできてから動かしたぶん（控え）を優先する
 * - ハッシュが無ければ控え。控えも無ければ null
 *
 * 同じ写真の「撮影地マップで見る」を続けて2回押すと、2回目は控えの
 * 位置が勝つ（ハッシュが同じなので戻りと区別できない）。こちらへ倒すのは、
 * 「戻るたびに全体へ戻される」方が毎回・誰でも踏むため
 */
export function chooseInitialView(hash: string, saved: SavedView | null): MapView | null {
    const fromHash = parseMapHash(hash);
    if (fromHash && (!saved || saved.hash !== hash)) return fromHash;
    return saved?.view ?? null;
}
