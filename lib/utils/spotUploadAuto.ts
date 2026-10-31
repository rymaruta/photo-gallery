// lib/utils/spotUploadAuto.ts
//
// **投稿画面で撮影スポットを自動で選ぶ**（2026-10-31 判断・journey.photo-ios#425）。
//
// 静的な生成の自動の結び（`spotAutoLink.ts`）と**同じ索引・同じ決まり**で、投稿する写真の撮影地・
// 題・説明・位置から撮影スポットの候補を見せる（切り替えは「入り」から）。
//
// 🔴 **自動の候補は投稿で `spotId` にしない**（2026-10-31 確かめの指摘）。結ぶのは静的な生成に任せ、
// 決まりを1か所に保つ——`spotId` に書くと、あとで決まりを直しても前の投稿に効かない。
// 書くのは本人が切り替えを切ったときの `spotAuto: "off"` だけ（書かないと、静的な生成が結ぶ）。
// 複数枚の投稿でも、本人が切り替えに触っていない写真には何も書かない（自動のまま）。
//
// 撮影スポットの画面から来た投稿（`?spot=`・`spotUpload.ts`）の明示の `spotId` は今までどおり送る。

import { spotIdToSend, type SpotUploadItem, type SpotUploadTarget } from "./spotUpload";
import { spotMatcher, SPOT_AUTO_OFF, type SpotMatcher, type SpotMatchIndex } from "./spotAutoLink";

/** 索引の置き場（`app/app/data/spot-match.json/route.ts`） */
export const SPOT_MATCH_URL = "/app/data/spot-match.json";

/** 読んだ索引を確かめる。形が違えば `null`（自動では選ばない側に倒す） */
export function parseSpotMatchIndex(json: unknown): SpotMatchIndex | null {
    if (!json || typeof json !== "object") return null;
    const o = json as Record<string, unknown>;
    if (o.v !== 1 || !Array.isArray(o.spots)) return null;
    const spots = o.spots.filter((r): r is SpotMatchIndex["spots"][number] =>
        !!r && typeof r === "object"
        && typeof (r as Record<string, unknown>).i === "string"
        && typeof (r as Record<string, unknown>).d === "string"
        && typeof (r as Record<string, unknown>).n === "string");
    return { v: 1, spots };
}

/** 投稿画面が持つ索引（突き合わせ器と、spotId → 名前） */
export type UploadSpotIndex = { matcher: SpotMatcher; names: Map<string, string> };

export function uploadSpotIndex(index: SpotMatchIndex): UploadSpotIndex {
    return { matcher: spotMatcher(index), names: new Map(index.spots.map((r) => [r.i, r.d])) };
}

/** 投稿する写真の、判定に要るところ */
export type UploadAutoItem = SpotUploadItem & { title?: string; description?: string };

/** 自動で選ぶ撮影スポット（`spotId`）。選べなければ `null` */
export function autoUploadSpot(index: UploadSpotIndex | null, item: UploadAutoItem): string | null {
    if (!index) return null;
    const coords = item.latitude !== undefined && item.longitude !== undefined
        ? { lat: item.latitude, lng: item.longitude } : null;
    return index.matcher.match({ location: item.location, title: item.title, description: item.description, coords });
}

/**
 * 保存で送る撮影スポットの項目。
 *   1. 撮影スポットの画面から来て、この写真が付く → `{ spotId }`（今までどおり・本人の明示の選択）
 *   2. 自動の候補があり、本人がこの写真で切り替えを切った → `{ spotAuto: "off" }`
 *   3. それ以外（自動の候補のまま・候補なし・触っていない）→ `{}`（静的な生成が同じ決まりで結ぶ）
 */
export function uploadSpotFields(args: {
    target: SpotUploadTarget | null;
    index: UploadSpotIndex | null;
    item: UploadAutoItem;
    /** 本人がこの写真で切り替えを切った（true）・入れ直した（false）。触っていなければ undefined */
    off?: boolean;
}): { spotId?: string; spotAuto?: typeof SPOT_AUTO_OFF } {
    const fromTarget = spotIdToSend(args.target, args.item);
    if (fromTarget) return { spotId: fromTarget };
    const auto = autoUploadSpot(args.index, args.item);
    if (!auto) return {};
    return args.off === true ? { spotAuto: SPOT_AUTO_OFF } : {};
}

/** 本人の切り替え（写真 ID → 入り true／切り false）を `uploadSpotFields` の `off` に。触っていなければ undefined */
export function choiceOff(choice: ReadonlyMap<string, boolean>, id: string): boolean | undefined {
    return choice.has(id) ? !choice.get(id) : undefined;
}
