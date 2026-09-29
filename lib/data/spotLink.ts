// lib/data/spotLink.ts
//
// **公式スポットの台帳から、画面が実際に使う項目だけを取り出す。**
//
// ## なぜ要るのか（実測）
//
// 🔴 `content/spots.json` は**人が書く棚**で、1件ごとに概要・見どころ・
// 季節・時間帯・構図・注意点・アクセス・出典まで持つ。ところが
// `lib/data/spots.ts` は `import spotsJson from "@/content/spots.json"` で
// **丸ごと**読むので、`"use client"` のファイルがここから `SPOTS` を
// 読むと**その全文がクライアントのチャンクに入る**。
//
// 台帳に1件だけ入れてビルドして数えた（2026-09-23）:
//
//     クライアントのチャンクに載っていた台帳の中身
//       49896f429396482b.js  → out/saved-spots.html
//       59b11b77059e2248.js  → out/photo/*.html      ← **写真ページ30枚すべて**
//
// 写真ページは**検索の着地点**で、CLAUDE.md の優先度（表示速度）に直接当たる。
// **JSON のモジュールは項目単位で落とせない**（台帳 `3ed31141` が
// `photos.json` で同じことを踏んで `photo-index.json` を作った）ので、
// 減らす手は1つ——**クライアントから台帳を import しない**。
//
// ## 使い方
//
// **この関数を呼んでよいのはサーバー側（`page.tsx` など）だけ。**
// 解いた結果（下の `SpotLink`）を props で画面へ渡す。
// 見張りは `app/__tests__/spotLedgerClientImport.test.ts`——`"use client"` の
// ファイルが `SPOTS` を値として import していたら落ちる。

import { SPOTS, type Spot } from "./spots";
import { visibleSpots, isPublished, usesMapHero, needsVisibleCredit } from "../utils/spotGuide";
import {
    PREFECTURES, OVERSEAS_SLUG, OVERSEAS_NAME, OVERSEAS_NAME_EN,
    prefectureByName, type RegionName,
} from "./prefectures";

/**
 * 画面がスポットへリンクするのに要る項目**だけ**。
 *
 * ここに項目を足すときは「本当に画面が読むか」を確かめること
 * ——足したぶんが写真ページ30枚のチャンクに乗る。
 */
export type SpotLink = {
    slug: string;
    name: string;
    /** 「香川県 観音寺市」。無ければ空文字 */
    region: string;
    /** 1〜2行の紹介。**カードで2行に切って出す**（長文の `description` は渡さない） */
    summary?: string;
    coords?: { lat: number; lng: number };
    /**
     * 代表写真。**権利が確認できているものだけ**（判断はサーバー側で済ませる）。
     * `null` なら画面は「写真なし」を出す。
     */
    cover: { src: string; alt: string; credit: string | null } | null;
    /**
     * **運営未確認の下書き（review）か、公開済み（人の確認か AI 照合）か。**
     * 画面はこれで「下書き」の札と「公式」の語を出し分ける（`isPublished` を
     * サーバー側で解いた値。クライアントに台帳の判定を持ち込まない）。
     */
    stage: "review" | "published";
};

/** 台帳の1件を、画面に渡す形へ落とす */
export function toSpotLink(spot: Spot): SpotLink {
    // **出すかどうかの判断はここで済ませる。** 画面に `spotGuide` の判定を
    // 持ち込むと、判断が2か所に散る（このリポジトリが何度も踏んでいる形）
    const cover = usesMapHero(spot) || !spot.coverImage
        ? null
        : {
            src: spot.coverImage.src,
            alt: spot.coverImage.alt,
            credit: needsVisibleCredit(spot)
                ? (spot.coverImage.requiredCreditText || spot.coverImage.credit)
                : null,
        };
    return {
        slug: spot.slug,
        name: spot.name,
        region: [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" "),
        summary: spot.summary,
        coords: spot.coords,
        cover,
        stage: isPublished(spot) ? "published" : "review",
    };
}

/**
 * 🔴 **索引（`/spots`）が読む形。**
 *
 * `SpotLink` ＋ テーマのチップに使う `category` **だけ**。
 *
 * ## なぜ足したか（2026-09-24・実ビルドで数えた）
 *
 * `app/spots/page.tsx` は `publishableSpots(SPOTS)` を**そのまま**
 * `"use client"` の `SpotIndexClient` に渡していた。Next はクライアント
 * 部品への props を RSC ペイロードとして**HTMLに埋め込む**ので、
 * **台帳の全文が索引ページに載っていた**:
 *
 *     out/spots.html   120件で **518,880 バイト**（1件あたり約4.3KB）
 *
 * 画面が読むのは name / slug / region / summary / category / cover の
 * 6つだけで、`description`・`highlights`・季節・時間帯・構図・`sources`
 * ——つまり1件の大半——は**誰も読まずにHTMLに乗っていた**。
 *
 * ⚠️ `spotLedgerClientImport.test.ts` は「クライアントが `SPOTS` を
 * import していないか」を見るが、**props で渡す経路は素通りする**。
 * この形が2つ目の抜け道だった。
 *
 * `deploy-static-site.js` は HTML を `no-cache, no-store` で配るので、
 * ここは**訪問のたびに落ちるバイト**になる（`CLAUDE.md` の表示速度の節）。
 */
export type SpotIndexItem = SpotLink & { category?: string };

/**
 * 写真が指しているスポット。**`spotId` でしか照合しない。**
 *
 * owner の指示書 第11章:「写真の `location` 文字列が似ているだけで、未確認の
 * スポットへ紐付けないでください」。`spotId` は人が選んだものしか入らない
 * ——運営が候補を確かめたものか、撮った本人がスポットの画面から選んだもの
 * （`api-user` の投稿・編集・2026-09-29）。
 */
export function spotLinkForPhoto(spotId: string | undefined | null): SpotLink | null {
    if (!spotId) return null;
    const spot = visibleSpots(SPOTS).find((s) => s.spotId === spotId);
    return spot ? toSpotLink(spot) : null;
}

/**
 * 地図に立てる公式スポット。**座標を持つものだけ。**
 *
 * `SpotLink` から `coords` を必須にしただけの形にするのは、地図側が
 * 「無いかもしれない」を毎回ほどかずに済むため（ピンは座標が無いと立たない）。
 */
export type SpotPin = {
    slug: string;
    name: string;
    region: string;
    lat: number;
    lng: number;
    /**
     * 代表写真。**権利が確認できているものだけ**（判断はサーバー側で済ませる）。
     * `null` なら画面は写真の枠を出さない。
     *
     * ⚠️ **足す項目は「本当に画面が読むか」を確かめてから。** ここに入れた
     * ぶんが `/map` のチャンクに、スポットの数だけ乗る。
     */
    cover: SpotLink["cover"];
    /** 下書きか公開済みか（`SpotLink.stage` と同じ） */
    stage: SpotLink["stage"];
};

/** 地図に立てられるスポット（ページを建てられる条件を満たし、座標を持つもの） */
export function spotPins(): SpotPin[] {
    const out: SpotPin[] = [];
    for (const spot of visibleSpots(SPOTS)) {
        if (!spot.coords) continue;
        const { slug, name, region, cover, stage } = toSpotLink(spot);
        out.push({ slug, name, region, cover, stage, lat: spot.coords.lat, lng: spot.coords.lng });
    }
    return out;
}

/** 公開してよいスポットを、スラッグで引ける形にして全部返す */
export function spotLinksBySlug(): Record<string, SpotLink> {
    const out: Record<string, SpotLink> = {};
    for (const spot of visibleSpots(SPOTS)) out[spot.slug] = toSpotLink(spot);
    return out;
}

/**
 * 公開してよいスポットを、**台帳の鍵（`spotId`）で引ける形**にして全部返す。
 *
 * 旅行プラン（`api-user/src/tripPlans.ts`）が保存するのは `spotId` で、
 * スラッグではない——`spots.ts` が書いているとおり、**スラッグは URL に
 * 出る綴りで、鍵は改名しても変わらない**。保存するものは鍵の方に寄せる。
 *
 * `SpotLink` に `spotId` を足さないのは、あの型が**写真ページ30枚の
 * チャンクに乗る**ため（同ファイル冒頭の実測）。引ける形を作るだけにする。
 */
export function spotLinksById(): Record<string, SpotLink> {
    const out: Record<string, SpotLink> = {};
    for (const spot of visibleSpots(SPOTS)) out[spot.spotId] = toSpotLink(spot);
    return out;
}

/**
 * 🔴 **旅行プラン（`/trips`）が読む項目だけ。**
 *
 * `spotLinksById` の docstring は「クライアントから台帳を import しない」
 * ことを書いているが、**props で渡す経路が抜けていた**——Next は
 * クライアント部品への props を RSC ペイロードとして**HTMLに埋め込む**ので、
 * 渡した `SpotLink` の全項目がそのページに乗る。`/spots` が同じ形で
 * 踏んでいる（`SpotIndexItem` の注記）。
 *
 * `TripsClient` が読むのは **`name`（項目の見出し）と `slug`（保存済みの
 * 行きたい場所との突き合わせ）の2つだけ**。実測（2026-09-24・台帳474件）:
 *
 *     spotLinksById()   97,043 バイト
 *     name + slug だけ  28,294 バイト   → **68,749 バイト（71%）が余分**
 *
 * `/trips` の HTML も `no-cache, no-store` で配る
 * （`scripts/deploy-static-site.js` の `isHtmlOrTxt`）ので、この差は
 * **訪問のたびに落ちるバイト**になる。
 *
 * `SpotLink` の部分型にしてあるので、`SpotLink` を渡す側はそのまま通る。
 */
export type SpotRef = Pick<SpotLink, "slug" | "name">;

/** 旅行プランに渡す一覧。`spotId` で引ける形で、**名前と綴りだけ** */
export function spotRefsById(): Record<string, SpotRef> {
    const out: Record<string, SpotRef> = {};
    for (const spot of visibleSpots(SPOTS)) {
        out[spot.spotId] = { slug: spot.slug, name: spot.name };
    }
    return out;
}

/**
 * 🔴 **`/spots` は都道府県の一覧にする。**
 *
 * 全件を1ページに並べると、伸びたぶんだけ索引が重くなる。実測（2026-09-24）:
 *
 *     1件あたり 1,809 バイト（`SpotIndexItem` に落としたあと）
 *     × 1,410件（各県30件）＝ **約2.4MB** が1枚のHTMLに乗る
 *
 * HTML は `no-cache, no-store` で配る（`scripts/deploy-static-site.js` の
 * `isHtmlOrTxt`）ので、これは**訪問のたびに落ちるバイト**になる。
 *
 * だからこの関数が返すのは**県の名前と件数だけ**。1件あたり50バイト前後で、
 * 47県でも 3KB に満たない。スポットの一覧は `/spots/area/<slug>` に分ける。
 */
export type SpotArea = {
    slug: string;
    name: string;
    nameEn: string;
    /** 地方。`null` は海外 */
    region: RegionName | null;
    /** ページを建てている件数（下書きを建てる設定なら下書きを含む） */
    count: number;
    /**
     * 人が確かめた件数。**検索に載せるか（サイトマップ・robots）はこちらで見る**
     * ——下書きしか無い県のページを検索に出さない。
     */
    publishedCount: number;
};

/** 台帳の1件が属する区画のスラッグ。**国内は都道府県・海外は一括** */
function areaSlugOf(spot: Spot): string | null {
    if (spot.region?.country !== "日本") return OVERSEAS_SLUG;
    return prefectureByName(spot.region?.prefecture)?.slug ?? null;
}

/** 区画のページ（`/spots/area/<slug>`）を指すのに要る項目 */
export type SpotAreaRef = { slug: string; name: string; nameEn: string };

/**
 * 台帳の1件が属する区画。**区画のページが在るときだけ返す**（`spotAreas` と同じ数え方
 * ——自分自身が数に入るので、見える1件なら必ず在る）。見えない行・県が引けない行は `null`
 */
export function spotAreaOf(spot: Spot, spots: readonly Spot[] = SPOTS): SpotAreaRef | null {
    if (!visibleSpots(spots).some((s) => s.spotId === spot.spotId)) return null;
    const slug = areaSlugOf(spot);
    if (!slug) return null;
    if (slug === OVERSEAS_SLUG) return { slug, name: OVERSEAS_NAME, nameEn: OVERSEAS_NAME_EN };
    const pref = PREFECTURES.find((p) => p.slug === slug);
    return pref ? { slug, name: pref.name, nameEn: pref.nameEn } : null;
}

/** 同じ区画のスポットか。**海外は一括の区画なので、国まで同じもの** */
export function sameAreaAs(a: Spot, b: Spot): boolean {
    const slug = areaSlugOf(a);
    if (!slug || slug !== areaSlugOf(b)) return false;
    return slug !== OVERSEAS_SLUG || (!!a.region?.country && a.region.country === b.region?.country);
}

/**
 * 公開できるスポットが**1件以上ある区画だけ**を、件数つきで返す。
 *
 * **0件の県は出さない。** `SpotIndexClient` が「0件のテーマは作らない」と
 * しているのと同じ理由——押しても何も無いリンクは、見た人の役に立たない。
 */
export function spotAreas(): SpotArea[] {
    const counts = new Map<string, number>();
    const published = new Map<string, number>();
    for (const s of visibleSpots(SPOTS)) {
        const slug = areaSlugOf(s);
        if (!slug) continue;
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
        if (isPublished(s)) published.set(slug, (published.get(slug) ?? 0) + 1);
    }
    const out: SpotArea[] = [];
    for (const p of PREFECTURES) {
        const n = counts.get(p.slug) ?? 0;
        if (n > 0) {
            out.push({
                slug: p.slug, name: p.name, nameEn: p.nameEn, region: p.region,
                count: n, publishedCount: published.get(p.slug) ?? 0,
            });
        }
    }
    const overseas = counts.get(OVERSEAS_SLUG) ?? 0;
    if (overseas > 0) {
        out.push({
            slug: OVERSEAS_SLUG, name: OVERSEAS_NAME, nameEn: OVERSEAS_NAME_EN,
            region: null, count: overseas, publishedCount: published.get(OVERSEAS_SLUG) ?? 0,
        });
    }
    return out;
}

/** その区画のスポット。索引と同じ軽い形（`/spots/area/<slug>` が読む） */
export function spotIndexItemsForArea(slug: string): SpotIndexItem[] {
    return visibleSpots(SPOTS)
        .filter((s) => areaSlugOf(s) === slug)
        .map((s) => ({ ...toSpotLink(s), ...(s.category ? { category: s.category } : {}) }));
}
