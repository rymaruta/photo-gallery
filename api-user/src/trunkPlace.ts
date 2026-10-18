/**
 * 旅のトランクのラベルの**地名を人に見せてよいか**（2026-10-18 coordinator 判断「確かめた物だけ見せる」）。
 *
 * ラベルの地名は「その人が行った場所」なので、人の口（`GET /users/{uid}/trunk`）に出すのは
 * **誰にでも見える公開の写真から来たと確かめた**ラベルだけにする。確かめた印が `placeOk`（保存は `o: 1`）。
 * 印の無いラベルは地名を伏せる＝**外し忘れても漏れない側に倒れる**（本番にもう在るラベルも印が無い）。
 *
 * ここは純関数だけ（DynamoDB を持たない）。`trunk.ts`（Lambda）と、本番のラベルに印を足す台本
 * （`scripts/backfill-trunk-place-ok.js`）が同じ判定を使う（写さない）。
 */
import { PREFECTURE_NAMES, countryOfText, prefectureOfPhoto } from "./badges";
import { isPublicListPhoto } from "./feed";
import type { Photo } from "./types";

export type LabelPlace = { name: string; latin?: string; country?: string };

const PLACE_NAME_MAX = 30;
const LATIN_RE = /^[\x20-\x7EÀ-ɏ]+$/;

/**
 * 土地。撮影地の文字 → スポット・座標から分かる県 → 空。
 * 2026-10-17 判断: `latin` は撮影地の文字にラテン文字の区切りがあるときだけ（訳さない・作らない）。
 * 国名は**メダルの表**（`countryOfText`）で当たったときと、県が分かったとき（日本）だけ
 */
export function placeOf(p: Photo): LabelPlace {
    const text = typeof p.location === "string" ? p.location.trim() : "";
    const parts = text.split(/[,、，/()（）]/).map((s) => s.trim()).filter(Boolean);
    const pref = prefectureOfPhoto(p);
    const country = countryOfText(text) ?? (pref !== null ? "日本" : undefined);
    let name = parts[0] ?? "";
    if (!name && pref !== null) name = PREFECTURE_NAMES[pref] ?? "";
    if (!name && country) name = country;
    const latin = parts.find((s) => LATIN_RE.test(s) && /[A-Za-z]/.test(s));
    return {
        name: name.slice(0, PLACE_NAME_MAX),
        ...(latin ? { latin: latin.slice(0, PLACE_NAME_MAX) } : {}),
        ...(country ? { country } : {}),
    };
}

/** 地名の比べ方（名前・ラテン文字・国の3つとも同じ） */
export const placeKey = (p: LabelPlace): string => JSON.stringify([p.name, p.latin ?? "", p.country ?? ""]);

/** 写真の持ち主 */
const ownerOf = (row: Record<string, unknown>) => row.userId ?? row.uploadedBy;

/**
 * この写真が、ラベルの地名を人に見せてよい根拠になるか: **本人の・誰にでも見える公開の写真**
 * （`feed.ts` の `isPublicListPhoto`＝公開の一覧と同じ線）で、**撮影地が今もラベルの地名と同じ**。
 * 2026-10-18 判断: 撮影地を書き換えたら（新しい撮影地で公開のままでも）見せない——ラベルの地名は配ったときの
 * もので、書き換えと食い違う。元の撮影地に戻せば、また見せる
 */
export function placeOkFor(place: LabelPlace, row: Record<string, unknown> | undefined, uid: string): boolean {
    if (!row || ownerOf(row) !== uid || !isPublicListPhoto(row)) return false;
    return placeKey(placeOf(row as unknown as Photo)) === placeKey(place);
}

/**
 * 写真の変化で、ラベルの地名を見せてよいかが変わりうるか（変わらなければ trunk を読まない）。
 * 公開の一覧に載るか・撮影地（`placeOf`）のどちらかが変わったときだけ true
 */
export function placeOkMayChange(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): boolean {
    const sig = (r: Record<string, unknown> | undefined) =>
        r ? `${isPublicListPhoto(r) ? 1 : 0}|${placeKey(placeOf(r as unknown as Photo))}` : "-";
    return sig(before) !== sig(after);
}

/** 公開の投稿の数（束 `groupId` は1件）。**誰にでも見える公開の写真だけ**（人のトランクの古び方に使う） */
export function countPublicPosts(photos: readonly Record<string, unknown>[]): number {
    const keys = new Set<string>();
    for (const p of photos) {
        if (!isPublicListPhoto(p)) continue;
        const g = typeof p.groupId === "string" ? p.groupId.trim() : "";
        keys.add(g ? `g:${g}` : `p:${String(p.id)}`);
    }
    return keys.size;
}

/**
 * 保存の形（短い鍵）のラベル1枚に、印を付け直す（台本が使う）。`photo` はラベルの id の写真
 * （束のラベルは束の最初の1枚。ほかの写真は見ない＝見せない側に倒す）
 */
export function storedLabelWithPlaceOk(
    l: Record<string, unknown>, photo: Record<string, unknown> | undefined, uid: string,
): Record<string, unknown> {
    const place: LabelPlace = {
        name: typeof l.n === "string" ? l.n : "",
        ...(typeof l.l === "string" ? { latin: l.l } : {}),
        ...(typeof l.c === "string" ? { country: l.c } : {}),
    };
    const { o: _o, ...rest } = l;
    void _o;
    return placeOkFor(place, photo, uid) ? { ...rest, o: 1 } : rest;
}
