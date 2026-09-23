// lib/utils/spotGuide.ts
//
// **公式撮影地ガイドの「出してよいか」を1か所で決める。**
//
// owner の指示書（2026-09-23）から、機械で効かせるべき規則は3つ:
//
//   1. 未確認の情報（交通規制・駐車場・撮影制限）を**推測で埋めない**
//   2. 名称と地図しかない**薄いページを大量に索引へ入れない**
//   3. 代表写真は**権利が確認できているものだけ**
//
// どれも「人が気をつける」では守れない（このリポジトリが何度も踏んでいる形）。
// **画面が読む関数の側**に置いて、条件を満たさないものは描かれないようにする。

import type { Spot, SpotSource } from "@/lib/data/spots";

/**
 * **出典が無ければ画面に出さない項目。**
 *
 * 選んだ基準は「**間違っていると実害が出る**」こと:
 *
 *   `access`      … 行き方。間違うと現地に着けない
 *   `parking`     … 駐車場。間違うと車で行って止められない
 *   `safetyNotes` … 立入禁止・撮影制限。間違うと**人が入ってはいけない所へ入る**
 *
 * 見どころ・構図・季節は**運営のアドバイス**なので、ここに入れない
 * （事実ではないものに出典を求めても意味が無い）。**事実と助言を分ける**の、
 * 型の上での実現。
 */
export const SOURCED_FIELDS = ["access", "parking", "safetyNotes"] as const;
export type SourcedField = (typeof SOURCED_FIELDS)[number];

/** その項目を裏付ける出典（0件なら空配列） */
export function sourcesFor(spot: Spot, field: string): SpotSource[] {
    return (spot.sources ?? []).filter(
        (s) => s && typeof s.url === "string" && s.url.length > 0
            && typeof s.checkedAt === "string" && s.checkedAt.length > 0
            && s.field === field,
    );
}

/**
 * その項目を画面に出してよいか。
 *
 * **出典が要る項目は、出典が1件も無ければ `false`。** 中身が書いてあっても出さない
 * ——「書いてあるのに出ない」は書いた人がすぐ気づくが、**出典の無い交通規制が
 * 出てしまう**のは誰も気づかない。気づける側に倒す。
 */
export function showsField(spot: Spot, field: string): boolean {
    if (!(SOURCED_FIELDS as readonly string[]).includes(field)) return true;
    return sourcesFor(spot, field).length > 0;
}

/**
 * 代表写真の欠けている必須項目。**空配列なら出してよい。**
 *
 * `credit` と `checkedAt` は**どのライセンスでも必須**——「誰のもので、いつ
 * 確認したか」が無い画像は、あとから追えない。`owner` でも撮影者は要る
 * （将来 owner 以外が運営に入ったときに誰の写真か分からなくなる）。
 */
export function coverImageProblems(spot: Spot): string[] {
    const c = spot.coverImage;
    if (!c) return [];
    const missing: string[] = [];
    if (!c.src?.trim()) missing.push("src");
    if (!c.alt?.trim()) missing.push("alt");
    if (!c.credit?.trim()) missing.push("credit");
    if (!c.checkedAt?.trim()) missing.push("checkedAt");
    if (!c.license) missing.push("license");
    // **「その場所の写真だと確かめたか」も必須。**
    // 写真があることと、そこで撮ったことは別（被写体と撮影位置は違いうる）
    if (c.verifiedPlace !== true) missing.push("verifiedPlace");
    // 許諾の条件としてクレジット表記が要るなら、文面まで持つ
    if (c.license !== "owner" && !c.credit?.trim()) missing.push("credit(非 owner は必須)");
    return missing;
}

/** 画面にクレジットを出すか（`owner` 以外は必ず出す） */
export function needsVisibleCredit(spot: Spot): boolean {
    const c = spot.coverImage;
    if (!c) return false;
    return c.license !== "owner" || Boolean(c.requiredCreditText?.trim());
}

/** 紹介文の最低の長さ。**これ未満は「完成している」と見なさない** */
export const SUMMARY_MIN = 40;

/**
 * **正式公開してよいか**（owner の指示書 第15章の条件を、そのまま式にした）。
 *
 * 満たさないものは `/spots/*` のページを作らない＝サイトマップにも載らない。
 * **写真の枚数は条件に入れない**（投稿0枚でも公開できるのが今回の肝）。
 *
 * 返すのは「足りないものの一覧」。空なら公開してよい。
 * **真偽1つにしない**——「なぜ出ないか」が分からないと、書く人が直せない。
 */
export function publishBlockers(spot: Spot): string[] {
    const missing: string[] = [];

    if (spot.status !== "published") missing.push("status が published でない");

    // 同一性: 人が確かめたか
    if (!spot.verifiedAt?.trim() && spot.verified !== true) missing.push("確認日（verifiedAt）が無い");

    // 所在地: 国と、地図に出せる座標
    if (!spot.region?.country?.trim()) missing.push("国（region.country）が無い");
    if (!spot.coords || !Number.isFinite(spot.coords.lat) || !Number.isFinite(spot.coords.lng)) {
        missing.push("座標（coords）が無い＝地図に出せない");
    }

    // 紹介文
    if ((spot.summary ?? "").trim().length < SUMMARY_MIN) {
        missing.push(`紹介文（summary）が ${SUMMARY_MIN} 文字未満`);
    }

    // 撮影地としての見どころ（**ここが「観光情報」と「撮影地ガイド」の差**）
    const hasHighlights = (spot.highlights ?? []).some((h) => h.trim().length > 0);
    const hasDescription = (spot.description ?? "").trim().length > 0;
    if (!hasHighlights && !hasDescription) missing.push("見どころ（highlights か description）が無い");

    // 行き方への導線: アクセスか、公式サイトのどちらか
    const hasAccess = showsField(spot, "access")
        && Boolean(spot.access?.transit || spot.access?.car || spot.access?.walk);
    const hasOfficial = Boolean(spot.officialWebsiteUrl?.trim());
    if (!hasAccess && !hasOfficial) missing.push("アクセスも公式サイトも無い");

    // 画像があるなら、権利が確認できていること
    const img = coverImageProblems(spot);
    if (img.length) missing.push(`代表写真に足りない項目: ${img.join(", ")}`);

    return missing;
}

/** 公開してよいスポットだけ */
export function publishableSpots(spots: readonly Spot[]): Spot[] {
    return spots.filter((s) => publishBlockers(s).length === 0);
}

/**
 * 代表写真が無いときに**地図を主役にする**かどうか。
 *
 * owner:「適切な代表写真が存在しない場合は、無関係な写真で埋めず、
 * 撮影地名と地図を中心とした代替レイアウトを表示してください」。
 */
export function usesMapHero(spot: Spot): boolean {
    return coverImageProblems(spot).length > 0 || !spot.coverImage;
}
