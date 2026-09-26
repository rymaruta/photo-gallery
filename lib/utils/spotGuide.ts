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
//
// ## 門は2段（2026-09-25）
//
//   `reviewBlockers`   … **ページを建ててよいか**（下書きとして）。確認日は見ない
//   `publishBlockers`  … **検索に載せ「公式」と名乗ってよいか**。人名つきの確認が要る
//
// 以前は1段で、`verified: true` と書いてあれば通った。1,417件を書いた AI が
// 全件に true と書き、誰も確かめていない台帳が「全件公開可能」になっていた
// （`lib/data/spots.ts` の `status` の注記）。**環境で分岐しない**——staging も
// 本番も同じページを建て、差は `robots.txt` だけ。純関数に env を混ぜると
// `npm run verify`（本番と同じ環境変数で建てる）が下書きの経路を一度も通らない。

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

/**
 * その項目を裏付ける出典（0件なら空配列）。
 *
 * **`checkedBy`（確かめた人の名前）が無い出典は数えない。** url と日付だけの
 * 出典は「候補」——2026-09-24 の17件は AI が書いた当日の `checkedAt` を
 * 持つだけで、人は1本も開いていない。
 */
export function sourcesFor(spot: Spot, field: string): SpotSource[] {
    return (spot.sources ?? []).filter(
        (s) => s && typeof s.url === "string" && s.url.length > 0
            && typeof s.checkedAt === "string" && s.checkedAt.length > 0
            && typeof s.checkedBy === "string" && s.checkedBy.trim().length > 0
            && s.field === field,
    );
}

/**
 * その項目を画面に出してよいか。
 *
 * **出典が要る項目は、出典が1件も無ければ `false`。** 中身が書いてあっても出さない
 * ——「書いてあるのに出ない」は書いた人がすぐ気づくが、**出典の無い交通規制が
 * 出てしまう**のは誰も気づかない。気づける側に倒す。
 *
 * **`published` でなければ、出典があっても出さない**（二重の門）。下書きの段階で
 * 駐車場や交通規制が出ると、帯1本の注意書きに全部を負わせることになる。
 */
export function showsField(spot: Spot, field: string): boolean {
    if (!(SOURCED_FIELDS as readonly string[]).includes(field)) return true;
    if (spot.status !== "published") return false;
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
 * **下書きとしてページを建ててよいか**（確認日は見ない）。
 *
 * owner の指示書 第15章の条件のうち、「人が確かめたか」以外を全部。
 * 満たさないものは `review` でもページを作らない。
 * **写真の枚数は条件に入れない**（投稿0枚でも建てられるのが今回の肝）。
 *
 * 返すのは「足りないものの一覧」。空なら建ててよい。
 * **真偽1つにしない**——「なぜ出ないか」が分からないと、書く人が直せない。
 */
export function reviewBlockers(spot: Spot): string[] {
    const missing: string[] = [];

    if (spot.status !== "review" && spot.status !== "published") {
        missing.push("status が review か published でない");
    }

    /**
     * 🔴 **URL に出る綴り。** 無いと `/spots/` のページが作られず、
     * それでも画面には出るので:
     *   - 「行きたい」の鍵が `SPOT-`（スラッグが空）になって保存されうる
     *   - その鍵は撮影地としても読めないので、**画面から外せなくなる**
     * `generateStaticParams` も空のスラッグを返すことになる。
     */
    if (!spot.slug?.trim()) missing.push("URL の綴り（slug）が無い");

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
    // （アクセスは出典つきで `published` のときしか「ある」と数えない）
    const hasAccess = showsField(spot, "access")
        && Boolean(spot.access?.transit || spot.access?.car || spot.access?.walk);
    const hasOfficial = Boolean(spot.officialWebsiteUrl?.trim());
    if (!hasAccess && !hasOfficial) missing.push("アクセスも公式サイトも無い");

    // 画像があるなら、権利が確認できていること
    const img = coverImageProblems(spot);
    if (img.length) missing.push(`代表写真に足りない項目: ${img.join(", ")}`);

    return missing;
}

/**
 * **正式公開してよいか**（検索に載せ、「公式」と名乗ってよいか）。
 *
 * `reviewBlockers` に加えて、**人が確かめた印**が要る:
 *   - `status` が `published`
 *   - `verifiedBy`（人名）と `verifiedAt`（日付）が対で揃っている
 *   - 出典が要る項目を書いているなら、`checkedBy` つきの出典がある
 *     （書いてあるのに出ない状態で「公開」にしない）
 *
 * 以前は `verified: true` でも通った。**AI が true と書けば通る**ので消した。
 */
export function publishBlockers(spot: Spot): string[] {
    const missing = reviewBlockers(spot);

    if (spot.status !== "published") missing.push("status が published でない");

    // 同一性: 人が確かめたか（名前と日付の両方）、または AI 照合の印が揃っているか
    if (!hasHumanCheck(spot) && !hasAiCheck(spot)) {
        if (spot.aiCheck) {
            missing.push("AI 照合の印が不完全（checkedAt・delegatedBy・出典1本以上）");
        } else {
            if (!spot.verifiedBy?.trim()) missing.push("確認者（verifiedBy）が無い");
            if (!spot.verifiedAt?.trim()) missing.push("確認日（verifiedAt）が無い");
        }
    }

    for (const field of SOURCED_FIELDS) {
        const written = (spot as Record<string, unknown>)[field] !== undefined;
        if (written && sourcesFor(spot, field).length === 0) {
            missing.push(`${field} が書いてあるのに、確認者つきの出典（checkedBy）が無い`);
        }
    }

    return missing;
}

/** 検索に載せてよいスポットだけ（サイトマップ・「公式」の表示・索引の判定） */
export function publishableSpots(spots: readonly Spot[]): Spot[] {
    return spots.filter((s) => publishBlockers(s).length === 0);
}

/**
 * **下書き（`review`）のページを建てるか。いまは建てない**（owner の判断・2026-09-25）。
 *
 * 台帳の 1,413件は AI が書いて誰も確かめていない。検索に載せない（noindex）
 * 形でも、本番の URL で「下書き（運営未確認）」のページを見せるより、
 * **確かめた行だけを出す**——owner の「本番に出せるものだけ出したい」への答え
 * （`docs/spot-guide-2026-09-23.md` §11c の「owner の判断待ち」の1つ目）。
 *
 * **環境では分けない**（上の「門は2段」の理由と同じ）。staging も本番も同じ値で、
 * 下書きを見たくなったらここを `true` にする。下書きの描き方（帯・`noindex`・
 * 「未確認のリンク」・県ページの「下書き」の題）はそのまま残してある。
 *
 * ⚠️ **false の間、`next build` と実ブラウザのスモークは下書きの経路を一度も
 * 通らない**（単体テストが `includeDrafts: true` で門を見るだけ）。`true` に
 * 戻すときは `npm run verify` を通し直し、下書きのページを目で1枚見ること。
 * ⚠️ 下書きを配った環境へ false の版を出すと、HTML の大半が消える側に回り
 * `scripts/deploy-static-site.js` の大量削除の見張りで止まる。その1回だけ
 * `ALLOW_BULK_DELETE=1` で流す（2026-09-25 時点で下書きを配った環境は無い）。
 */
export const BUILD_DRAFT_SPOTS = false;

/**
 * **ページを建ててよいスポット。** 画面・地図・アプリ向けの JSON・県ページは
 * すべてこれを母集合にする（ここ1か所で出す／出さないが決まる）。サイトマップの
 * 個別ページは、より狭い `publishableSpots` を読む。
 *
 * 公開済み（`publishBlockers` が空）は常に。下書き（`review`・`reviewBlockers` が空）は
 * `includeDrafts` のときだけ（既定は `BUILD_DRAFT_SPOTS`）。
 */
export function visibleSpots(
    spots: readonly Spot[],
    { includeDrafts = BUILD_DRAFT_SPOTS }: { includeDrafts?: boolean } = {},
): Spot[] {
    return spots.filter((s) =>
        s.status === "published"
            ? publishBlockers(s).length === 0
            : includeDrafts && s.status === "review" && reviewBlockers(s).length === 0,
    );
}

function hasHumanCheck(spot: Spot): boolean {
    return Boolean(spot.verifiedBy?.trim()) && Boolean(spot.verifiedAt?.trim());
}

/**
 * **AI 照合の印が揃っているか**（owner の委任・2026-09-26）。
 * 照合日・委任した人・出典（https）1本以上。**人の確認とは別**——`isVerified` は偽のまま
 */
export function hasAiCheck(spot: Spot): boolean {
    const c = spot.aiCheck;
    return Boolean(c?.checkedAt?.trim())
        && Boolean(c?.delegatedBy?.trim())
        && Array.isArray(c?.sources)
        && c!.sources.some((s) => /^https:\/\//.test(s.url ?? "") && Boolean(s.title?.trim()));
}

/**
 * **公開済みか**（下書きの帯・検索避け・アプリの「下書き」札を出し分ける）。
 * 人の確認でも AI 照合でもよい。「運営が確かめた」と書くのは `isVerified` だけ
 */
export function isPublished(spot: Spot): boolean {
    return spot.status === "published" && publishBlockers(spot).length === 0;
}

/**
 * **人が確かめたスポットか**（画面が読む純関数）。
 *
 * `true` のときだけ「情報の最終確認: <日付>（運営）」と「公式」の語を出す。
 * `status` だけを見ない——`published` と書いてあっても名前と日付が無ければ嘘になる。
 */
export function isVerified(spot: Spot): boolean {
    return spot.status === "published" && hasHumanCheck(spot);
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
