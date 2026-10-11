// lib/data/badgeShelf.ts
//
// **名前の横の設定**と**メダルの棚**の、画面に依らない部分（iOS で先に入れたものを Web に足す。
// 2026-10-11 owner の決定）。絵・名前・並びは `badges.ts` を使い回し、ここは
//
// - 自分のプロフィールの**生の値**から設定の初期値を読む（`readNameSide`）
// - 変わった項目だけを `PUT /user/profile` の本文にする（`nameSideChanges`）
// - `GET /user/badges` の進み具合から棚の行を組む（`ownShelf`）／人の棚は持っているものだけ（`othersShelf`）
//
// 2026-10-11 判断: 初期値は `sanitizeProfile`（`lib/utils/profileShape.ts`）を**通さない**。
// あちらは `proMarkStyle` を plate 以外 iris に読み替える（公開の形には "none" が来ないため）ので、
// 印を外している人（"none"）の設定画面が「絞り羽根」で開き、何も触らずに決めても
// 外したはずの印が戻ってしまう。生の応答から、ここで形だけ確かめて読む。

import {
    BADGE_KEYS, badgeDescription, badgeLabel, isBadgeKey, ownedBadges, sanitizeBadgeMap,
    type BadgeKey, type BadgeMap, type FixedBadgeKey,
} from "./badges";

type Locale = "ja" | "en";

/** 名前の横の Pro の印の形。`none` は印を外している（本人の応答にだけ来る） */
export type NameSideMarkStyle = "iris" | "plate" | "none";

/** 設定で変えられる3項目 */
export type NameSide = {
    displayBadge: BadgeKey | null;
    proMarkStyle: NameSideMarkStyle;
    verifiedMarkOff: boolean;
};

/** 設定の画面が要る、自分のプロフィールの値 */
export type NameSideProfile = NameSide & {
    badges?: BadgeMap;
    /** Pro が今有効か。印の形は Pro の間しか出ないので、Pro でなければ形の選択を出さない */
    pro: boolean;
    /** 公式の資格（本人の応答では外していても true）。公式でない人には「付ける／外す」を出さない */
    verified: boolean;
    displayName?: string;
};

/**
 * `GET /user/profile`（本人の応答）の生の値から、設定の初期値を読む。
 * オブジェクトでなければ null（「取れなかった」。未設定の人と同じ見た目にしない）
 */
export function readNameSide(raw: unknown): NameSideProfile | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const badges = sanitizeBadgeMap(o.badges);
    const style = o.proMarkStyle;
    const name = typeof o.displayName === "string" && o.displayName.trim() ? o.displayName.trim() : undefined;
    return {
        badges,
        // 持っていない鍵は「選んでいない」（サーバーの `badgeFields` と同じ判定）
        displayBadge: isBadgeKey(o.displayBadge) && badges?.[o.displayBadge] ? o.displayBadge : null,
        proMarkStyle: style === "plate" || style === "none" ? style : "iris",
        verifiedMarkOff: o.verifiedMarkOff === true,
        pro: o.pro === true,
        verified: o.verified === true,
        ...(name ? { displayName: name } : {}),
    };
}

/**
 * `PUT /user/profile` に送る本文。**変わった項目だけ**（部分更新の口なので、
 * 触っていない項目は送らない——同時に開いている編集画面の保存とぶつけない）。
 *
 * - `displayBadge` を外すときは `null`（サーバーは `null` / `""` で外す）
 * - `verifiedMarkOff` は**公式の人だけ**（真偽で送る。`false` が「付ける」）
 * - 何も変わっていなければ空のオブジェクト（呼び出し側は送らない）
 */
export function nameSideChanges(
    initial: NameSide,
    current: NameSide,
    opts: { verified: boolean },
): Partial<NameSide> {
    const body: Partial<NameSide> = {};
    if (initial.displayBadge !== current.displayBadge) body.displayBadge = current.displayBadge;
    if (initial.proMarkStyle !== current.proMarkStyle) body.proMarkStyle = current.proMarkStyle;
    if (opts.verified && initial.verifiedMarkOff !== current.verifiedMarkOff) body.verifiedMarkOff = current.verifiedMarkOff;
    return body;
}

// ── 棚 ─────────────────────────────────────────────

/** `GET /user/badges` の進み具合（決まった鍵ごと）。サーバーの `badgeProgress` の形 */
export type BadgeProgressEntry = { count: number; tier: number; next: number | null };
export type BadgeProgressMap = Partial<Record<FixedBadgeKey, BadgeProgressEntry>>;

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** 進み具合を、形の合った行だけにする（知らない鍵・数でない値は落とす） */
export function readBadgeProgress(raw: unknown): BadgeProgressMap {
    const out: BadgeProgressMap = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const key of BADGE_KEYS) {
        const v = (raw as Record<string, unknown>)[key];
        if (!v || typeof v !== "object") continue;
        const { count, tier, next } = v as Record<string, unknown>;
        if (!isCount(count) || !isCount(tier)) continue;
        out[key] = { count, tier, next: isCount(next) ? next : null };
    }
    return out;
}

/** 「あと◯」の単位（板の「あと[25]枚で次」「あと[3]冊で次」） */
const UNITS: Partial<Record<FixedBadgeKey, { ja: string; en: string }>> = {
    first: { ja: "枚", en: " photo" },
    morning: { ja: "枚", en: " photos" },
    night: { ja: "枚", en: " photos" },
    books: { ja: "冊", en: " books" },
    seasons: { ja: "年", en: " years" },
    supporterYear: { ja: "か月", en: " months" },
};

/**
 * 棚の1枚の下に出す進み具合。板（`Shelf.dc.html`）の言い方:
 * 持っていて上がない → 「達成」、持っていて上がある → 「あと17で次」、まだ → 「あと5枚」
 */
export function progressText(key: FixedBadgeKey, p: BadgeProgressEntry | undefined, owned: boolean, locale: Locale): string {
    const en = locale === "en";
    // 進み具合が読めなかった（応答に無い）ときは何も出さない——「達成」と言い切らない
    if (!p) return "";
    if (p.next === null) return owned ? (en ? "Complete" : "達成") : "";
    const left = p.next - p.count;
    // 数え直しの前後で線に届いている（次に開いたとき段が上がる）
    if (left <= 0) return en ? "Next tier soon" : "まもなく次の段";
    const unit = UNITS[key]?.[locale] ?? "";
    if (owned) return en ? `${left}${unit} to next` : `あと${left}${unit}で次`;
    return en ? `${left}${unit} to go` : `あと${left}${unit}`;
}

export type ShelfItem = {
    key: BadgeKey;
    /** 絵に使う段（まだのものは1段目の絵を灰色で） */
    tier: number;
    owned: boolean;
    label: string;
    sub: string;
    /** その段を取った日（ISO）。人の棚だけ添える（自分の棚は「あと◯で次」を出す） */
    at?: string;
};

/**
 * 自分の棚。持っているもの（`ownedBadges` の順）→ まだのもの（数えるメダルだけ）。
 *
 * 2026-10-11 判断: まだのものに Pro のメダル（サポーター章・続けた年・季節の章）と
 * 初期ユーザーは並べない。**Web では何も売らない**（`badges.ts` の注記）ので、灰色で並べても
 * 手に入れる道を示せない。初期ユーザーは登録の日付で決まり、あとから取れない
 */
export function ownShelf(badges: BadgeMap | undefined, progress: BadgeProgressMap, locale: Locale): ShelfItem[] {
    const owned = ownedBadges(badges);
    const ownedKeys = new Set<string>(owned.map((b) => b.key));
    const items: ShelfItem[] = owned.map(({ key, tier }) => ({
        key, tier, owned: true,
        label: badgeLabel(key, tier, locale),
        // 進み具合の在るもの（数えるメダル・続けた年）は「あと◯で次」、1段だけの章は中身の説明
        sub: hasProgress(key) ? progressText(key, progress[key], true, locale) : badgeDescription(key, tier, locale),
    }));
    for (const key of BADGE_KEYS) {
        if (ownedKeys.has(key) || !COUNTED.has(key)) continue;
        items.push({
            key, tier: 1, owned: false,
            label: badgeLabel(key, 1, locale),
            sub: progressText(key, progress[key], false, locale),
        });
    }
    return items;
}

/** 人の棚。**持っているものだけ**（公開プロフィールの `badges`）。下には中身の説明 */
export function othersShelf(badges: BadgeMap | undefined, locale: Locale): ShelfItem[] {
    return ownedBadges(badges).map(({ key, tier, at }) => ({
        key, tier, owned: true,
        label: badgeLabel(key, tier, locale),
        sub: badgeDescription(key, tier, locale),
        at,
    }));
}

/** 数えるメダル（サーバーの `COUNTED_BADGE_KEYS`）。まだのものを棚に並べてよいのはこれだけ */
const COUNTED = new Set<string>(["first", "prefectures", "countries", "seasons", "morning", "night", "books", "wish"]);

function hasProgress(key: BadgeKey): key is FixedBadgeKey {
    return COUNTED.has(key) || key === "supporterYear";
}
