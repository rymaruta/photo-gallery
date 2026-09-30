// lib/utils/spot.ts
// 撮影スポット詳細（`/location/<スラッグ>`）が使う純関数。
// fs も JSX も持たないので、サーバー・クライアント・テストのどこからでも読める。

import type { Photo } from "../data/photos";
import { collectEntries, slugify, type CollectionEntry } from "./collections";
import { haversineKm } from "./journey";
import { photoIsInLocation } from "./related";
import { dedupeCameraName } from "./cameraName";
import { splitStoredDate } from "./photoDate";

/**
 * **このファイルは「無い情報を作らない」ための境界。**
 *
 * スポット詳細の「概要」は、`photos.json` に**実際に入っている値**だけから
 * 組む。紹介文は生成しない（owner の指示）。人気の根拠を持っていないので
 * 「最近人気」のような肩書きも名乗らない。
 *
 * だから返す型は**数えた結果か、写真が持っていた値そのもの**しかない。
 * 文章を作る関数はここに置かない。
 */

const isPublished = (p: Photo) => p.published !== false;

/** 撮影地の「所在地」——**推測しない**。書かれている値をそのまま分ける */
export type SpotPlace = {
    /** 見出しに出すスポット名（＝そのページの代表表記） */
    name: string;
    /**
     * 名前より広い所在地。**書かれている値から切り出すだけ**で、
     * 国名や都道府県を当てに行くことはしない。
     *
     * 実データの撮影地は「香川県 観音寺市 高屋神社」「パリ, フランス」の
     * ように**広い順・狭い順が混ざる**ので、どちらか片方に決め打つと
     * 半分が嘘になる。**同じ一覧にある他の撮影地が、この名前を
     * 「含んでいる」か「含まれる」か**という、既に在る関係だけを使う。
     */
    broader: string[];
};

/**
 * そのスポットを含む、より広い撮影地（`photoIsInLocation` の向きそのまま）。
 *
 * 「この撮影地で撮った写真は、どの広い撮影地のページにも載るか」を集める。
 * `photoIsInLocation(狭い, 広い)` が真になる `広い` 側が答え。
 *
 * **新しい同一性の規則は作らない。** 集約ページの枚数・noindex の判定が
 * 使っているのと**同じ関数・同じ向き**で引く。ここで別の寄せ方をすると、
 * 画面に出る関係と検索に出る枚数が食い違う（このリポジトリが何度も
 * 踏んでいる形）。
 */
export function broaderSpots(label: string, all: CollectionEntry[]): CollectionEntry[] {
    return all
        .filter((e) => e.label !== label && photoIsInLocation(label, e.label))
        // **広い順には並べられない。並べたふりもしない。**
        //
        // 一度「名前が短い方が広い」で並べたが**逆になる**——実在する
        // `/location/パリ,-フランス` の広い方は「パリ」(2文字) と
        // 「フランス」(4文字) で、短いのは**狭い方の「パリ」**。
        //
        // では包含で決められるかというと、**決められない**。
        // `photoIsInLocation` は字の包含なので、`"パリ"` と `"フランス"` は
        // **どちらも相手を含まない**——このデータは「フランスの方が広い」を
        // 知らない。知らないものを順番で主張しないこと（画面側も
        // `/` 区切りの住所風には描かない）。
        //
        // 入れ子になっている組だけは包含で決まるので、そこは決める。
        // 決まらない組は枚数の多い順 → slug 順。**決着まで書く**
        // ——書かないと入力配列の順という書いていない規則で並ぶ
        // （`relatedCollectionPhotos` と同じ理由）。
        .sort((a, b) => {
            // a が b に含まれる＝a の方が狭い → b を先に
            if (photoIsInLocation(a.label, b.label)) return 1;
            if (photoIsInLocation(b.label, a.label)) return -1;
            return b.count - a.count || a.slug.localeCompare(b.slug);
        });
}

/**
 * そのスポットの中にある、より細かい撮影地。
 *
 * `broaderSpots` の逆向き。`/location/パリ` から
 * `/location/オペラ・ガルニエ（パリ）` へ降りられるようにする。
 */
export function narrowerSpots(label: string, all: CollectionEntry[]): CollectionEntry[] {
    return all
        .filter((e) => e.label !== label && photoIsInLocation(e.label, label))
        .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/**
 * そのスポットの代表座標。
 *
 * **正確な GPS と、地名から引いたおおよその位置（`geoApprox`）を混ぜない。**
 * 混ぜると「約1kmに丸めた GPS」と「街の中心」が同じ点として平均され、
 * どちらでもない座標ができる。**正確な方が1枚でもあればそちらだけを使い**、
 * 無ければ推定だけを使って `approx: true` を立てる。
 *
 * 平均ではなく**中央値**を取る。平均は外れ値1枚（別の街で撮った写真が
 * 同じ撮影地名で保存されている場合）に引きずられて、どの写真の場所でも
 * ない点になる。
 *
 * 座標そのものは既に `sanitizeCoords` が**約1kmに丸めている**
 * （`api-user/src/sanitize.ts`。自宅の特定を防ぐため）。ここは丸めた値を
 * 読むだけで、**精度を上げ直すことはしない**。
 */
export type SpotCoords = { lat: number; lng: number; approx: boolean };

export function spotCoords(photos: Photo[]): SpotCoords | null {
    // **有限の数であることまで見る**（`PhotoMap` が同じデータに同じ判定を
    // 掛けている）。NaN が1件混ざると、地図タブが「位置がありません」では
    // なく座標ありの文面を出し、周辺のスポットに `NaNkm` が**静的HTMLへ
    // 焼き込まれる**（直すには再ビルドが要る）
    const hasCoords = (p: Photo) =>
        !!p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng);
    const exact = photos.filter((p) => hasCoords(p) && !p.geoApprox);
    const source = exact.length > 0 ? exact : photos.filter(hasCoords);
    if (source.length === 0) return null;
    const median = (xs: number[]) => {
        const s = [...xs].sort((a, b) => a - b);
        const mid = s.length >> 1;
        // 偶数個なら真ん中2つの平均。**丸めた座標どうしの平均**なので
        // 粒度は変わらない（新しい精度を作らない）
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    return {
        lat: median(source.map((p) => p.coords!.lat)),
        lng: median(source.map((p) => p.coords!.lng)),
        approx: exact.length === 0,
    };
}

export type NearbySpot = CollectionEntry & { km: number; approx: boolean };

/**
 * 周辺のスポット（**距離順**）。
 *
 * **座標を持つスポットどうしでしか出せない。** 片方でも座標が無ければ
 * 距離は分からないので、**その組は出さない**——「近い順」と名乗って
 * 距離を知らないものを混ぜない。
 *
 * ⚠️ **コミット済みの `app/data/photos.json`（公開30枚）は座標を1件も
 * 持たない**（実測）。本番では `scripts/geocode-locations.js` が地名から
 * 引いた `geoApprox` の座標を入れているので出るが、**手元のビルドでは
 * この節は出ない**。出ない状態を「壊れている」と読まないこと。
 *
 * `approx` は「その距離が、地名から引いたおおよその位置に基づく」印。
 * 画面はこれを見て断りを書く（`geoApprox` を正確な GPS と区別する）。
 */
/**
 * 「周辺のスポット」と呼んでよい距離（km）。**アプリと同じ値**
 * （iOS の `DerivedSpot.nearbyMaxKm`・2026-09-30）。以前は上限が無く、写真の少ない
 * 地域では数百km先（パリから「バルセロナ 約825km」）まで「周辺」と名乗っていた。
 * 足りなくても遠い場所で埋めない（0件なら節ごと出ない）
 */
export const NEARBY_MAX_KM = 50;

export function nearbySpots(
    here: SpotCoords | null,
    others: Array<{ entry: CollectionEntry; coords: SpotCoords | null }>,
    limit = 6,
    maxKm = NEARBY_MAX_KM,
): NearbySpot[] {
    if (!here) return [];
    return others
        .flatMap(({ entry, coords }) =>
            coords
                ? [{
                    ...entry,
                    km: haversineKm(here, coords),
                    // どちらか一方でも推定なら、その距離は推定
                    approx: here.approx || coords.approx,
                }]
                : [])
        // **「周辺」と呼べる距離まで**（上の `NEARBY_MAX_KM` の注記）
        .filter((x) => x.km <= maxKm)
        // 同点の決着まで書く（`relatedCollectionPhotos` と同じ理由——
        // 書かないと「どれが載るか」が入力配列の順という書いていない規則で決まる）
        .sort((a, b) => a.km - b.km || b.count - a.count || a.slug.localeCompare(b.slug))
        .slice(0, limit);
}

/**
 * 概要タブに出す「持っているデータ」。
 *
 * **ここに文章は無い。** 数と、写真が持っていた値そのものだけ。
 */
export type SpotFacts = {
    /** そのページに載る公開写真の枚数 */
    photoCount: number;
    /** 撮った人の数（`userId` の異なり。持たない写真は数えない） */
    photographerCount: number;
    /** 撮影された期間（`date` を持つ写真だけから。無ければ null） */
    period: { from: string; to: string } | null;
    /** 使われたカメラ（多い順）。`dedupeCameraName` を通した値 */
    cameras: Array<{ name: string; count: number }>;
    /** よく付いているタグ（多い順・生の表記） */
    tags: Array<{ label: string; slug: string; count: number }>;
};

/** 「YYYY-MM-DD」まで（時刻は落とす）。並べ替えにも表示にも使える形 */
function ymd(value: unknown): string | null {
    const p = splitStoredDate(value);
    if (!p) return null;
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function spotFacts(photos: Photo[], topN = 6): SpotFacts {
    const pub = photos.filter(isPublished);
    const people = new Set<string>();
    const cameras = new Map<string, number>();
    // タグは**畳んだ鍵で数え、出すのは生の表記**（`collectEntries` と同じ規則）
    const tagVotes = new Map<string, Map<string, number>>();
    const dates: string[] = [];

    for (const p of pub) {
        if (p.userId) people.add(p.userId);
        const cam = dedupeCameraName(p.exif?.camera);
        if (cam) cameras.set(cam, (cameras.get(cam) ?? 0) + 1);
        // **`date`（撮影日）だけを見る。`createdAt` は投稿日**で、
        // 撮影された期間として出すと嘘になる（実データは30枚中8枚しか
        // 撮影日を持たず、残りはアップロードした年に固まっている）
        const d = ymd(p.date);
        if (d) dates.push(d);
        const seen = new Set<string>();
        for (const raw of p.tags ?? []) {
            const t = (raw ?? "").toString().trim();
            if (!t) continue;
            const slug = slugify(t, "tag");
            if (!slug) continue;
            const votes = tagVotes.get(slug) ?? new Map<string, number>();
            votes.set(t, (votes.get(t) ?? 0) + 1);
            tagVotes.set(slug, votes);
            seen.add(slug);
        }
        for (const slug of seen) {
            const votes = tagVotes.get(slug)!;
            // 件数は写真1枚につき1回（`collectEntries` と同じ）
            votes.set("__count__", (votes.get("__count__") ?? 0) + 1);
        }
    }

    dates.sort();
    const byCountThenName = <T extends { count: number }>(key: (x: T) => string) =>
        (a: T, b: T) => b.count - a.count || key(a).localeCompare(key(b));

    return {
        photoCount: pub.length,
        photographerCount: people.size,
        period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
        cameras: [...cameras.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort(byCountThenName((x) => x.name))
            .slice(0, topN),
        tags: [...tagVotes.entries()]
            .map(([slug, votes]) => {
                const count = votes.get("__count__") ?? 0;
                const label = [...votes.entries()]
                    .filter(([k]) => k !== "__count__")
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? slug;
                return { slug, label, count };
            })
            .sort(byCountThenName((x) => x.slug))
            .slice(0, topN),
    };
}

/**
 * スポット詳細が要る材料を1回で組む（**サーバーで呼ぶ**）。
 *
 * 呼び出し側（`SpotPage`）で組み立てると、`map(slimForGrid)` を1つ消しても
 * 誰も気づかない形になる——`related.ts` の `initialRelatedFor` が同じ理由で
 * 同じ判断をしている。
 */
export function spotDetail(photos: Photo[], label: string, matched: Photo[]) {
    const entries = collectEntries(photos, "location");
    const here = spotCoords(matched);
    // **自分に座標が無ければ、相手の座標も引かない。**
    //
    // `nearbySpots` は `!here` で即 `[]` を返すので、組み立てが丸ごと無駄に
    // なる——しかもその組み立ては**撮影地の数 × 全写真**の
    // `photoIsInLocation`（静的書き出しは全撮影地ページでこれを回すので
    // O(撮影地² × 写真)）。
    //
    // そして**コミット済みの `photos.json` は座標を1件も持たない**（0/30）
    // ＝いまはビルドの全ページがこの断面。本番でも、座標を持つのは
    // `geocode-locations.js` が当てられた撮影地だけ。
    const others = here
        ? entries
            .filter((e) => e.label !== label)
            .map((e) => ({
                entry: e,
                coords: spotCoords(photos.filter((p) => isPublished(p) && photoIsInLocation(p.location, e.label))),
            }))
        : [];
    return {
        facts: spotFacts(matched),
        coords: here,
        broader: broaderSpots(label, entries),
        narrower: narrowerSpots(label, entries),
        nearby: nearbySpots(here, others),
    };
}
