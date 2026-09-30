// lib/utils/spotUpload.ts
//
// **撮影スポットの画面から投稿する**（`/spots/<slug>` →「ここで撮った写真を投稿する」）。
//
// スポットの写真一覧は `spotId` でしか拾わない（`SpotGuidePage` の `photosForSpot`・
// 名前の一致では紐付けない）。だから投稿画面が `spotId` を送らなければ、その導線から
// 上げた写真は**その場所に並ばない**。API（`/upload/save` の `spotId`）は前からあるので、
// ここは「どのスポットか」を運び、**どの写真に付けてよいか**を決めるだけ。
//
// ## 運び方
//
// URL は `?spot=<slug>` だけ。スポットの ID・名前・座標は、ビルド時に書き出してある
// 場所ごとの本文（`/app/data/spots/<slug>.json`・`lib/data/spotBody.ts`・約1.6KB）から読む。
//   - 索引（`/app/data/spots.json`）は約 865KB あるので、投稿画面では読まない
//   - URL に ID や名前を載せない——載せると「銀山温泉に投稿」と見せて別の場所の ID を
//     付ける細工ができる。画面に出す名前と送る ID は同じ1本の JSON から取る
//   - ログインへ回っても `?spot=` は戻り先に残る（`useLoginRedirect` が
//     `pathname + search` を `next` に入れる）
//
// ## どの写真に付けるか（iOS の `UploadSpotTarget` と同じ規則）
//
//   1. 写真に位置情報が無い、または位置情報がスポットから 10km 以内
//      ——同じ画面で別の旅の写真を混ぜて選んでも、そちらは付けない
//   2. 撮影地の欄にスポット名を含む——利用者が撮影地を消した・別の場所に書き換えた
//      写真は付けない（名前を含めば「銀山温泉 夜」のような書き足しは残す）
//
// 判定は**保存する瞬間に写真ごと**に行う。下書きの復元・複数枚・失敗後の押し直しでも、
// そのときの写真の中身で同じ答えになる（覚えておいた答えを使い回さない）。

import { haversineKm } from "./journey";
import { ROUTES } from "../routes";

/** 投稿画面が運ぶスポット（本文 JSON から読んだもの） */
export type SpotUploadTarget = {
    spotId: string;
    slug: string;
    name: string;
    coords?: { lat: number; lng: number };
};

/** 写真のうち、判定に要るところだけ */
export type SpotUploadItem = {
    location: string;
    latitude?: number;
    longitude?: number;
};

/** 「同じ場所で撮った」とみなす距離（iOS の `UploadSpotTarget.nearbyKm` と同じ） */
export const SPOT_NEARBY_KM = 10;

/** サーバーの `sanitizeSpotId` と同じ形（`api-user/src/sanitize.ts`） */
const SPOT_ID = /^sp_[0-9a-f]{12}$/;
/** スポットの綴り。`/spots/<slug>` のもの（英小文字・数字・ハイフン） */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** スポットの画面から投稿画面へのリンク */
export function spotUploadHref(slug: string): string {
    return `${ROUTES.UPLOAD}?spot=${encodeURIComponent(slug)}`;
}

/** `?spot=` の値を確かめる。形が違えば `null`（読みに行かない） */
export function readSpotParam(raw: string | null | undefined): string | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    return s.length > 0 && s.length <= 100 && SLUG.test(s) ? s : null;
}

/** 本文 JSON の読む先 */
export function spotBodyUrl(slug: string): string {
    return `/app/data/spots/${encodeURIComponent(slug)}.json`;
}

/**
 * 本文 JSON を投稿画面の形へ。**頼んだ綴りと違う・ID の形が違う・名前が無い**なら
 * `null`（紐付けない。黙って別の場所に付けるより、付けない方に倒す）
 */
export function parseSpotBody(json: unknown, slug: string): SpotUploadTarget | null {
    if (!json || typeof json !== "object") return null;
    const o = json as Record<string, unknown>;
    if (o.slug !== slug) return null;
    if (typeof o.spotId !== "string" || !SPOT_ID.test(o.spotId)) return null;
    if (typeof o.name !== "string" || !o.name.trim()) return null;
    const c = o.coords as { lat?: unknown; lng?: unknown } | undefined;
    const coords = c && typeof c.lat === "number" && typeof c.lng === "number"
        && Number.isFinite(c.lat) && Number.isFinite(c.lng)
        ? { lat: c.lat, lng: c.lng }
        : undefined;
    return { spotId: o.spotId, slug, name: o.name.trim(), ...(coords ? { coords } : {}) };
}

/** 写真がスポットの近くで撮られたか（位置情報が無ければ「分からない＝近い」とみなす） */
export function coversSpot(target: SpotUploadTarget, item: SpotUploadItem): boolean {
    if (item.latitude === undefined || item.longitude === undefined) return true;
    if (!target.coords) return true;
    return haversineKm({ lat: item.latitude, lng: item.longitude }, target.coords) <= SPOT_NEARBY_KM;
}

/** 保存で送る `spotId`。付けない写真は `undefined` */
export function spotIdToSend(target: SpotUploadTarget | null, item: SpotUploadItem): string | undefined {
    if (!target) return undefined;
    if (!coversSpot(target, item)) return undefined;
    if (!item.location.includes(target.name)) return undefined;
    return target.spotId;
}
