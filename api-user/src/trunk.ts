import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, randomInt } from "crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { requireEnv } from "./env";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { listMyPhotos } from "./ddb-photos";
import { updateUserRow, UserListError } from "./userList";
import { isPro } from "./badgeKeys";
import {
    PREFECTURE_NAMES, coordsOf, countryOfText, isCountablePhoto,
    prefectureOfPhoto, seasonOf, yearMonthOf,
} from "./badges";
import type { Photo } from "./types";

/**
 * 旅のトランク（iOS の新機能・2026-10-17 owner 承認）。
 *
 * 公開した投稿1件ごとにラベルを1枚「手持ち（pocket）」に配り、本人がトランクに
 * 「貼る（stuck）」。**絵は保存しない**——アプリが `seed` と `kind` から描く。
 *
 * ## 持ち方
 *
 * photos テーブルの1行 `trunk#<uid>`（`userList.ts` の `updateUserRow`＝読む → rev 条件で Put）。
 * 新しい GSI・テーブル・IAM は足さない。行は `uid` を持ち `userId` を持たないので、
 * 写真の索引（`userId-createdAt-index`）には現れない（`follow#` などと同じ）。
 *
 *     model          選んでいる型（Pro の型のままでも保存は残す）
 *     lastFreeModel  最後に選んだ無料の型（Pro をやめたときに見せる型・既定 leather）
 *     pocket[]       手持ち（新しい順）
 *     stuck[]        貼ったもの（新しい順）
 *     rerolls        { month: 日本時間の YYYY-MM, used }
 *     pendingReroll  { labelId, seeds[3], at }（作り直しの候補・選ぶまで）
 *     receiveLabels  ラベルを受け取るか（既定 true。false の間は配らない・戻してもさかのぼらない）
 *     dealt[]        配った写真の指紋の台帳（新しい順・最新 3000 件）。**写真やラベルを消しても消さない**
 *     daily          { day: 日本時間の YYYY-MM-DD, count }（その日に配った枚数）
 *     rev            書き込みの版
 *
 * ## 決まり
 *
 * - ラベルの id は写真の id。**同じ写真に二度配らない**（再送・同時の保存でも）
 * - 手持ちの上限は無料 30・Pro 150。いっぱいなら配らない（投稿は通常どおり成功）。
 *   貼ったものは数えない。貼った一覧は最大 1200 件
 * - **集める悪用を防ぐ**（2026-10-17 owner）: 同じ写真（指紋）には一度だけ・1日3枚まで・
 *   投稿から24時間以内に写真を消したら手持ちのラベルを取り消す（`revokeLabel`）
 * - 作り直しは Pro だけ・日本時間の月に3回・繰り越しなし。候補3つを出し、選んで確定
 * - Pro の型は Pro の間だけ選べる。やめたら `effectiveModel` を `lastFreeModel` にし、
 *   保存（`model`）は残す（再開すれば戻る）。手持ちが30を超えていても消さない
 */

const USERS_TABLE = requireEnv("USERS_TABLE");

export const trunkId = (uid: string) => `trunk#${uid}`;

export const FREE_MODELS = ["leather", "canvas", "aluminum", "steamer"] as const;
export const PRO_MODELS = ["urushi", "kori", "sleeper", "clipper", "captain", "starchart"] as const;
export type TrunkModel = (typeof FREE_MODELS)[number] | (typeof PRO_MODELS)[number];
export const DEFAULT_MODEL: TrunkModel = "leather";

export const POCKET_LIMIT_FREE = 30;
export const POCKET_LIMIT_PRO = 150;
/** 貼った一覧の上限。写真の上限（`photoLimit.ts` の 1000）に余裕を見て */
export const STUCK_MAX = 1200;
export const REROLLS_PER_MONTH = 3;
export const REROLL_CANDIDATES = 3;
/**
 * きらきら（foil）の出る確率（1万分の）。
 * 2026-10-17 判断: 2%（50枚に1枚）。公開の投稿が月に数枚の人でも、年に1枚は出会える程度
 */
export const FOIL_PER_10000 = 200;
/**
 * 1行の大きさの上限（DynamoDB の1項目は 400KB）。ラベル1枚はおよそ 200〜250 バイトで、
 * 1350 枚（150＋1200）でも 340KB 前後に収まる見込みだが、地名の長い人のために余白で止める
 * （2026-10-17 判断: 越えるなら配らない・貼らない。黙って切り詰めない）
 */
export const TRUNK_BUDGET_BYTES = 380 * 1024;
/**
 * 悪用を防ぐ上限（2026-10-17 判断・owner の指示の数をここにまとめる）。
 * - 1日（日本時間）に配るのは3枚まで（owner 2026-10-17。最初の指示の5枚から改めた）。数えるのは配れた枚数だけ。取り消しても戻さない
 *   （消して上げ直す往復で日の枠を回復させない）
 * - 投稿から24時間以内に写真を消したら、手持ちに残っているラベルを取り消す（貼ったものは消さない）
 * - 指紋の台帳は最新3000件（古い順に落とす）。1件 14 文字（およそ17バイト）で、全部でおよそ 50KB
 */
export const DAILY_DEAL_MAX = 3;
export const REVOKE_WINDOW_MS = 24 * 3_600_000;
export const DEALT_LEDGER_MAX = 3000;

/** 本流（savePhoto）の中で待ってよい上限。メダルの数え直し（`badgeStore.ts` の QUIET_LIMIT_MS）と同じ */
export const TRUNK_QUIET_LIMIT_MS = 2500;

const PLACE_NAME_MAX = 30;

export const LABEL_KINDS = ["milestone", "timeslot", "season", "place"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export const TIMESLOTS = ["dawn", "dusk", "night"] as const;
export const MILESTONES = ["first", "posts10", "posts50", "posts100", "firstCountry"] as const;

export type TrunkLabel = {
    id: string;
    photoId: string;
    kind: LabelKind;
    place: { name: string; latin?: string; country?: string };
    season?: (typeof SEASONS)[number];
    timeslot?: (typeof TIMESLOTS)[number];
    milestone?: (typeof MILESTONES)[number];
    seed: number;
    at: string;
    foil?: true;
    /**
     * 同じ投稿の束（写真の `groupId`）。2026-10-17 判断: 束で上げた投稿（写真の行が幾つもある）は
     * **1投稿＝1枚**にするため、配るときの見分けに持つ（アプリは読まなくてよい）
     */
    groupId?: string;
};

export type PendingReroll = { labelId: string; seeds: number[]; at: string };

export type TrunkDoc = {
    model: TrunkModel;
    lastFreeModel: TrunkModel;
    pocket: TrunkLabel[];
    stuck: TrunkLabel[];
    rerolls: { month: string; used: number };
    pendingReroll?: PendingReroll;
    receiveLabels: boolean;
    dealt: string[];
    daily: { day: string; count: number };
};

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T =>
    typeof v === "string" && (list as readonly string[]).includes(v);

export const isTrunkModel = (v: unknown): v is TrunkModel => isIn(FREE_MODELS, v) || isIn(PRO_MODELS, v);
const isFreeModel = (v: unknown): v is TrunkModel => isIn(FREE_MODELS, v);

const LABEL_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const isSeed = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2 ** 31;

/** 保存されているラベルの形か（形の違うものは読むときに落とす） */
export function isTrunkLabel(v: unknown): v is TrunkLabel {
    if (!v || typeof v !== "object") return false;
    const l = v as Record<string, unknown>;
    const place = l.place as Record<string, unknown> | undefined;
    return typeof l.id === "string" && LABEL_ID_RE.test(l.id)
        && typeof l.photoId === "string"
        && isIn(LABEL_KINDS, l.kind)
        && !!place && typeof place === "object" && typeof place.name === "string"
        && isSeed(l.seed)
        && typeof l.at === "string";
}

/** 日本時間の YYYY-MM */
export function jstMonth(now: Date): string {
    return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 7);
}

/** 日本時間の YYYY-MM-DD */
export function jstDay(now: Date): string {
    return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 写真の指紋（同じ写真を消して上げ直してもラベルが届かないように）。
 *
 * 2026-10-17 判断: **EXIF の撮影日時＋機種＋画像の大きさ**の組を sha256 に通した先頭12桁。
 * アップロードの処理は中身のハッシュを持っていない（presign で長さを縛るだけで、S3 の ETag を
 * 読むには HeadObject の権限が要る＝IAM の変更になる）ので使わない。
 * 3つとも無い写真（スクリーンショット・EXIF を落とした書き出し）は**写真 id だけ**で見る
 * ——上げ直せば別の id になるので、その写真は消して上げ直すと届く（日の上限3枚が歯止め）。
 * ⚠️ 同じ秒・同じ機種・同じ大きさの連写は同じ指紋になる（2枚目は `duplicate`）。それは許す
 */
export function fingerprintOf(p: Photo): string {
    const e = p.exif ?? {};
    const parts = [e.dateTimeOriginal, e.camera, e.imageSize].map((v) => (typeof v === "string" ? v.trim() : ""));
    // 台帳を小さく保つため、id だけの指紋も同じ長さに縮める（`i:` と `x:` で混ざらない）
    if (parts.every((v) => v === "")) return `i:${shortHash(p.id)}`;
    return `x:${shortHash(parts.join("\u0000"))}`;
}

function shortHash(v: string): string {
    return createHash("sha256").update(v).digest("hex").slice(0, 12);
}

/** 行（無ければ undefined）を、使ってよい形に読み直す */
export function parseTrunk(item: Record<string, unknown> | undefined): TrunkDoc {
    const labels = (v: unknown) => Array.isArray(v) ? (v as unknown[]).filter(isTrunkLabel) : [];
    const r = item?.rerolls as { month?: unknown; used?: unknown } | undefined;
    const p = item?.pendingReroll as { labelId?: unknown; seeds?: unknown; at?: unknown } | undefined;
    const pending: PendingReroll | undefined = p && typeof p.labelId === "string" && Array.isArray(p.seeds)
        && p.seeds.every(isSeed) && p.seeds.length > 0
        ? { labelId: p.labelId, seeds: p.seeds as number[], at: typeof p.at === "string" ? p.at : "" }
        : undefined;
    return {
        model: isTrunkModel(item?.model) ? item.model : DEFAULT_MODEL,
        lastFreeModel: isFreeModel(item?.lastFreeModel) ? item.lastFreeModel : DEFAULT_MODEL,
        pocket: labels(item?.pocket),
        stuck: labels(item?.stuck),
        rerolls: {
            month: typeof r?.month === "string" ? r.month : "",
            used: typeof r?.used === "number" && Number.isInteger(r.used) && r.used >= 0 ? r.used : 0,
        },
        ...(pending ? { pendingReroll: pending } : {}),
        receiveLabels: item?.receiveLabels !== false,
        dealt: Array.isArray(item?.dealt) ? (item.dealt as unknown[]).filter((x): x is string => typeof x === "string") : [],
        daily: {
            day: typeof (item?.daily as { day?: unknown })?.day === "string" ? (item!.daily as { day: string }).day : "",
            count: typeof (item?.daily as { count?: unknown })?.count === "number" ? (item!.daily as { count: number }).count : 0,
        },
    };
}

/** 書く項目（`updateUserRow` が id・uid・rev・updatedAt を足す） */
function serialize(doc: TrunkDoc): Record<string, unknown> {
    return {
        model: doc.model,
        lastFreeModel: doc.lastFreeModel,
        pocket: doc.pocket,
        stuck: doc.stuck,
        rerolls: doc.rerolls,
        ...(doc.pendingReroll ? { pendingReroll: doc.pendingReroll } : {}),
        receiveLabels: doc.receiveLabels,
        dealt: doc.dealt.slice(0, DEALT_LEDGER_MAX),
        daily: doc.daily,
    };
}

const fitsBudget = (doc: TrunkDoc) => Buffer.byteLength(JSON.stringify(serialize(doc)), "utf8") <= TRUNK_BUDGET_BYTES;

export const pocketLimit = (pro: boolean) => (pro ? POCKET_LIMIT_PRO : POCKET_LIMIT_FREE);

/** 今月使った作り直しの回数（月が替わっていれば 0＝繰り越しなし） */
export function rerollsUsed(doc: TrunkDoc, now: Date): number {
    return doc.rerolls.month === jstMonth(now) ? doc.rerolls.used : 0;
}

/** Pro の型は Pro の間だけ。やめたら最後の無料の型（保存は残す） */
export function effectiveModel(doc: TrunkDoc, pro: boolean): TrunkModel {
    return isFreeModel(doc.model) || pro ? doc.model : doc.lastFreeModel;
}

// ─── ラベルの中身 ───────────────────────────────────────────

/** 公開している投稿の数。束（`groupId`）は1投稿に数える */
export function countPosts(photos: Photo[]): number {
    const keys = new Set<string>();
    for (const p of photos) {
        if (!isCountablePhoto(p)) continue;
        keys.add(postKey(p));
    }
    return keys.size;
}

function postKey(p: Photo): string {
    const g = typeof p.groupId === "string" ? p.groupId.trim() : "";
    return g ? `g:${g}` : `p:${p.id}`;
}

/** EXIF の撮影時刻の「時」（その土地の時計）。読めなければ null */
export function shotHour(p: Photo): number | null {
    const raw = p.exif?.dateTimeOriginal;
    if (typeof raw !== "string") return null;
    const m = /^\d{4}[-:/]\d{2}[-:/]\d{2}[ T](\d{2}):\d{2}/.exec(raw.trim());
    if (!m) return null;
    const h = Number(m[1]);
    return h >= 0 && h <= 23 ? h : null;
}

/** 夜明け 4–6・夕方 16–18・夜 20–3（時の値で見る。両端を含む） */
export function timeslotOf(hour: number | null): TrunkLabel["timeslot"] | undefined {
    if (hour === null) return undefined;
    if (hour >= 4 && hour <= 6) return "dawn";
    if (hour >= 16 && hour <= 18) return "dusk";
    if (hour >= 20 || hour <= 3) return "night";
    return undefined;
}

const LATIN_RE = /^[\x20-\x7EÀ-ɏ]+$/;

/**
 * 土地。撮影地の文字 → スポット・座標から分かる県 → 空。
 * 2026-10-17 判断: `latin` は撮影地の文字にラテン文字の区切りがあるときだけ（訳さない・作らない）。
 * 国名は**メダルの表**（`countryOfText`）で当たったときと、県が分かったとき（日本）だけ
 */
export function placeOf(p: Photo): TrunkLabel["place"] {
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

/**
 * 節目。はじめての投稿 ＞ 100・50・10 投稿目 ＞ はじめての国。
 * `others` は**この投稿を除いた**、本人の公開している写真。
 */
export function milestoneOf(p: Photo, others: Photo[]): TrunkLabel["milestone"] | undefined {
    const n = countPosts(others) + 1;
    if (n === 1) return "first";
    if (n === 100) return "posts100";
    if (n === 50) return "posts50";
    if (n === 10) return "posts10";
    const country = countryOfText(p.location);
    if (country) {
        const seen = new Set(others.filter(isCountablePhoto).map((o) => countryOfText(o.location)));
        if (!seen.has(country)) return "firstCountry";
    }
    return undefined;
}

export type Rand = (minInclusive: number, maxExclusive: number) => number;
const cryptoRand: Rand = (a, b) => randomInt(a, b);

export const newSeed = (rand: Rand = cryptoRand) => rand(1, 2 ** 31 - 1);

/**
 * 1枚を組み立てる。kind は 節目 ＞ 時刻 ＞ 季節 ＞ 土地 の順で、当たったもので決める。
 * 季節と時刻は、kind が別でも分かれば載せる（アプリの飾りに使える）。
 * 2026-10-17 判断: どれにも当たらない（撮影地も日付も無い）投稿は `place`（名前は空）にする——配らないと
 * 「投稿1件ごとに1枚」が崩れる
 */
export function buildLabel(p: Photo, others: Photo[], now: Date, rand: Rand = cryptoRand): TrunkLabel {
    const milestone = milestoneOf(p, others);
    const timeslot = timeslotOf(shotHour(p));
    const ym = yearMonthOf(p);
    const c = coordsOf(p);
    const season = ym ? SEASONS[seasonOf(ym.m, !!c && c.lat < 0)] : undefined;
    const kind: LabelKind = milestone ? "milestone" : timeslot ? "timeslot" : season ? "season" : "place";
    const g = typeof p.groupId === "string" ? p.groupId.trim() : "";
    return {
        id: p.id,
        photoId: p.id,
        kind,
        place: placeOf(p),
        ...(season ? { season } : {}),
        ...(timeslot ? { timeslot } : {}),
        ...(milestone ? { milestone } : {}),
        seed: newSeed(rand),
        at: now.toISOString(),
        ...(rand(0, 10_000) < FOIL_PER_10000 ? { foil: true as const } : {}),
        ...(g ? { groupId: g } : {}),
    };
}

// ─── 配る ───────────────────────────────────────────────────

export type DealOutcome = {
    label: TrunkLabel | null;
    labelSkipped?: "draft" | "off" | "duplicate" | "daily" | "full" | "samePost" | "timeout" | "error";
};

/**
 * 手持ちに足す（純関数）。**変えないときは doc: null**。
 * この順に見る:
 * - 同じ id が手持ちか貼った方に在る → そのラベルを返す（再送・非公開→公開で二度配らない）
 * - 受け取らない設定 → 配らない（`off`）。台帳にも載せない
 * - 同じ束の投稿に配り済み → 配らない（`samePost`）
 * - 指紋が台帳に在る（消して上げ直した・前に配って手持ちから削除した）→ 配らない（`duplicate`）
 * - その日に3枚配った → 配らない（`daily`）
 * - 手持ちが上限 → 配らない（`full`）。貼ったものは数えない
 */
export function dealInto(
    doc: TrunkDoc, label: TrunkLabel, limit: number, fingerprint: string, now: Date,
): { doc: TrunkDoc | null; outcome: DealOutcome } {
    const existing = doc.pocket.find((l) => l.id === label.id) ?? doc.stuck.find((l) => l.id === label.id);
    if (existing) return { doc: null, outcome: { label: existing } };
    if (!doc.receiveLabels) return { doc: null, outcome: { label: null, labelSkipped: "off" } };
    if (label.groupId && [...doc.pocket, ...doc.stuck].some((l) => l.groupId === label.groupId)) {
        return { doc: null, outcome: { label: null, labelSkipped: "samePost" } };
    }
    // 台帳は配ったときに必ず載る＝手持ちから削除したあとの再送でも、消して上げ直しても戻らない
    if (doc.dealt.includes(fingerprint)) {
        return { doc: null, outcome: { label: null, labelSkipped: "duplicate" } };
    }
    const day = jstDay(now);
    const todayCount = doc.daily.day === day ? doc.daily.count : 0;
    if (todayCount >= DAILY_DEAL_MAX) return { doc: null, outcome: { label: null, labelSkipped: "daily" } };
    if (doc.pocket.length >= limit) return { doc: null, outcome: { label: null, labelSkipped: "full" } };
    const next: TrunkDoc = {
        ...doc,
        pocket: [label, ...doc.pocket],
        dealt: [fingerprint, ...doc.dealt],   // 上限（古い順に落とす）は serialize で切る
        daily: { day, count: todayCount + 1 },
    };
    if (!fitsBudget(next)) return { doc: null, outcome: { label: null, labelSkipped: "full" } };
    return { doc: next, outcome: { label } };
}

async function readProfileBits(uid: string): Promise<Record<string, unknown> | undefined> {
    const res = await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: uid },
        ProjectionExpression: "userId, supporter",
    }));
    return res.Item as Record<string, unknown> | undefined;
}

/**
 * 公開した投稿にラベルを1枚配る。読む・書くで落ちたら投げる（`grantLabelQuietly` が握る）。
 * 下書き・ストーリーは配らない（メダルと同じ `isCountablePhoto` の線）。
 */
export async function grantLabel(uid: string, photo: Photo, now: Date = new Date(), rand: Rand = cryptoRand): Promise<DealOutcome> {
    if (!uid || !isCountablePhoto(photo)) return { label: null, labelSkipped: "draft" };
    const [profile, mine] = await Promise.all([readProfileBits(uid), listMyPhotos(uid)]);
    const limit = pocketLimit(isPro(profile, now.getTime()));
    const key = postKey(photo);
    // この投稿（束なら束ごと）を除く。索引は結果整合なので、いま書いた行が見えていてもいなくても同じ数になる
    const others = mine.filter((o) => isCountablePhoto(o) && o.id !== photo.id && postKey(o) !== key);
    // 乱数は**書く前に1回だけ**引く（競合で読み直しても同じ1枚を足す）
    const label = buildLabel(photo, others, now, rand);
    const fp = fingerprintOf(photo);
    let outcome: DealOutcome = { label: null, labelSkipped: "error" };
    await updateUserRow(trunkId(uid), uid, (item) => {
        const r = dealInto(parseTrunk(item), label, limit, fp, now);
        outcome = r.outcome;
        return r.doc ? serialize(r.doc) : null;
    });
    return outcome;
}

/**
 * savePhoto の成功のあとに呼ぶ。**投げない・上限つきで待つ**（`refreshBadgesQuietly` と同じ形）。
 * 上限を越えたら `timeout`（書き込みはそのまま走りうる。届いていれば `GET /user/trunk` に出る）。
 */
export async function grantLabelQuietly(uid: string, photo: Photo, label: string): Promise<DealOutcome> {
    if (!uid || !isCountablePhoto(photo)) return { label: null, labelSkipped: "draft" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            grantLabel(uid, photo).catch((e): DealOutcome => {
                console.error(`${label}: ラベルを配れませんでした（${uid}）:`, e);
                return { label: null, labelSkipped: "error" };
            }),
            new Promise<DealOutcome>((resolve) => {
                timer = setTimeout(() => resolve({ label: null, labelSkipped: "timeout" }), TRUNK_QUIET_LIMIT_MS);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ─── 口 ─────────────────────────────────────────────────────

const NO_STORE = { ...JSON_HEADERS, "Cache-Control": "private, no-store" };

function view(doc: TrunkDoc, pro: boolean, now: Date) {
    return {
        model: doc.model,
        effectiveModel: effectiveModel(doc, pro),
        pocket: doc.pocket.map(stripInternal),
        stuck: doc.stuck.map(stripInternal),
        limit: pocketLimit(pro),
        isPro: pro,
        rerolls: { left: pro ? Math.max(0, REROLLS_PER_MONTH - rerollsUsed(doc, now)) : 0, month: jstMonth(now) },
        ...(doc.pendingReroll ? { pendingReroll: doc.pendingReroll } : {}),
        receiveLabels: doc.receiveLabels,
    };
}

/** 束の印は配るときの見分けだけに使う（応答には出さない） */
function stripInternal(l: TrunkLabel): Omit<TrunkLabel, "groupId"> {
    const { groupId: _g, ...rest } = l;
    void _g;
    return rest;
}

/** 手で返す失敗（`updateUserRow` の mutate から投げて、口で応答に直す） */
class TrunkError extends Error {
    constructor(readonly status: number, message: string, readonly code: string) { super(message); }
}

type Mutation = (doc: TrunkDoc, ctx: { pro: boolean; now: Date }) => TrunkDoc | null;

async function mutateTrunk(uid: string, pro: boolean, now: Date, fn: Mutation): Promise<TrunkDoc> {
    let last: TrunkDoc | null = null;
    await updateUserRow(trunkId(uid), uid, (item) => {
        const doc = parseTrunk(item);
        const next = fn(doc, { pro, now });
        last = next ?? doc;
        if (next && !fitsBudget(next)) throw new TrunkError(409, "トランクがいっぱいです", "full");
        return next ? serialize(next) : null;
    });
    return last ?? parseTrunk(undefined);
}

function body(event: { body?: string | null; isBase64Encoded?: boolean }): Record<string, unknown> {
    if (!event.body) return {};
    try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
        const v = JSON.parse(raw);
        return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
        throw new TrunkError(400, "不正なリクエスト", "badRequest");
    }
}

/** 手持ちから貼る。貼った方に在れば何もしない（再送で 404 にしない） */
export const stickMutation = (id: string): Mutation => (doc) => {
    if (doc.stuck.some((l) => l.id === id)) return null;
    const label = doc.pocket.find((l) => l.id === id);
    if (!label) throw new TrunkError(404, "ラベルが見つかりません", "notFound");
    if (doc.stuck.length >= STUCK_MAX) throw new TrunkError(409, "トランクがいっぱいです", "full");
    return {
        ...doc,
        pocket: doc.pocket.filter((l) => l.id !== id),
        stuck: [label, ...doc.stuck],
        // 選びかけの作り直しは手持ちのラベルだけのもの。貼ったら捨てる（使った回数は戻らない）
        ...(doc.pendingReroll?.labelId === id ? { pendingReroll: undefined } : {}),
    };
};

/** 手持ちから削除（貼ったものは消せない） */
export const removeMutation = (id: string): Mutation => (doc) => {
    if (!doc.pocket.some((l) => l.id === id)) throw new TrunkError(404, "ラベルが見つかりません", "notFound");
    return {
        ...doc,
        pocket: doc.pocket.filter((l) => l.id !== id),
        ...(doc.pendingReroll?.labelId === id ? { pendingReroll: undefined } : {}),
    };
};

/**
 * 作り直し（Pro・月3回）。候補 seed を3つ出して `pendingReroll` に置く。
 * - 同じラベルに選びかけがあれば**そのまま返す**（回数を使わない・再送で二重に減らさない）
 * - 別のラベルに選びかけがあれば 409（先に選ぶ）。2026-10-17 判断: 黙って捨てると払った1回が消える
 * - foil は作り直しても保つ（2026-10-17 判断: 図柄だけ替える。きらきらは運で引いた「その投稿の」もの）
 */
export const rerollMutation = (id: string, seeds: number[]): Mutation => (doc, { pro, now }) => {
    if (!pro) throw new TrunkError(403, "Pro の機能です", "proOnly");
    if (!doc.pocket.some((l) => l.id === id)) throw new TrunkError(404, "ラベルが見つかりません", "notFound");
    if (doc.pendingReroll) {
        if (doc.pendingReroll.labelId === id) return null;
        throw new TrunkError(409, "選びかけの作り直しがあります", "pendingReroll");
    }
    const used = rerollsUsed(doc, now);
    if (used >= REROLLS_PER_MONTH) throw new TrunkError(409, "今月の作り直しは使い切りました", "noRerollsLeft");
    return {
        ...doc,
        rerolls: { month: jstMonth(now), used: used + 1 },
        pendingReroll: { labelId: id, seeds, at: now.toISOString() },
    };
};

/**
 * 候補から選ぶ（今の図柄を選んでもよい＝回数は戻らない）。
 * 2026-10-17 判断: 作り直しのあとに Pro が切れても選べる（回数はもう払ってある）
 */
export const chooseMutation = (id: string, seed: unknown): Mutation => (doc) => {
    const pending = doc.pendingReroll;
    if (!pending || pending.labelId !== id) throw new TrunkError(404, "作り直しの候補がありません", "noPending");
    const label = doc.pocket.find((l) => l.id === id);
    if (!label) throw new TrunkError(404, "ラベルが見つかりません", "notFound");
    if (!isSeed(seed) || (seed !== label.seed && !pending.seeds.includes(seed))) {
        throw new TrunkError(400, "候補にない図柄です", "badSeed");
    }
    return {
        ...doc,
        pocket: doc.pocket.map((l) => (l.id === id ? { ...l, seed } : l)),
        pendingReroll: undefined,
    };
};

/** 型を選ぶ。Pro の型は Pro の間だけ。無料の型を選んだら `lastFreeModel` も替える */
export const modelMutation = (model: unknown): Mutation => (doc, { pro }) => {
    if (!isTrunkModel(model)) throw new TrunkError(400, "型が正しくありません", "badModel");
    if (!isFreeModel(model) && !pro) throw new TrunkError(403, "Pro の型です", "proOnly");
    if (doc.model === model && (!isFreeModel(model) || doc.lastFreeModel === model)) return null;
    return { ...doc, model, ...(isFreeModel(model) ? { lastFreeModel: model } : {}) };
};

/**
 * 受け取る／受け取らない。2026-10-17 owner: 止めていた間のぶんは、戻してもさかのぼって配らない
 * （配るのは savePhoto のその場だけなので、止めていた間の投稿はそもそも数えていない）
 */
export const settingsMutation = (receiveLabels: unknown): Mutation => (doc) => {
    if (typeof receiveLabels !== "boolean") throw new TrunkError(400, "設定が正しくありません", "badRequest");
    return doc.receiveLabels === receiveLabels ? null : { ...doc, receiveLabels };
};

/**
 * 写真を消したときの取り消し（純関数）。**投稿から24時間以内**で、ラベルが**手持ちに残っている**ときだけ外す。
 * 貼ったものは消さない。指紋の台帳と日の枚数はそのまま（上げ直しても届かない・日の枠も戻らない）。
 * 投稿の時刻は写真の `createdAt`、読めなければラベルの `at`
 */
export function revokeFrom(doc: TrunkDoc, photoId: string, postedAt: unknown, now: Date): TrunkDoc | null {
    const label = doc.pocket.find((l) => l.id === photoId);
    if (!label) return null;
    const posted = typeof postedAt === "string" && Number.isFinite(Date.parse(postedAt)) ? Date.parse(postedAt) : Date.parse(label.at);
    if (!Number.isFinite(posted) || now.getTime() - posted > REVOKE_WINDOW_MS) return null;
    return {
        ...doc,
        pocket: doc.pocket.filter((l) => l.id !== photoId),
        ...(doc.pendingReroll?.labelId === photoId ? { pendingReroll: undefined } : {}),
    };
}

/**
 * 写真の削除（`photoUpdate.ts` の `deleteMyPhoto`）のあとに呼ぶ。**投げない・上限つきで待つ**。
 * 落ちても削除は成功のまま（ラベルが手持ちに残るだけ）。
 * 退会は行ごと消す（`account.ts`）ので、ここは通らない
 */
export async function revokeLabelQuietly(uid: string, photoId: string, postedAt: unknown, label: string): Promise<void> {
    if (!uid || !photoId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            updateUserRow(trunkId(uid), uid, (item) => {
                if (!item) return null;
                const next = revokeFrom(parseTrunk(item), photoId, postedAt, new Date());
                return next ? serialize(next) : null;
            }).catch((e) => {
                console.error(`${label}: ラベルを取り消せませんでした（${uid}）:`, e);
            }),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, TRUNK_QUIET_LIMIT_MS); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 旅のトランクの口（1つの関数に寄せる。CloudFormation の部品が上限 500 に近いため）。
 *
 *     GET    /user/trunk                         → view ＋ posts（公開している投稿の数・古び方用）
 *     POST   /user/trunk/labels/{id}/stick       → view
 *     DELETE /user/trunk/labels/{id}             → view
 *     POST   /user/trunk/labels/{id}/reroll      → view（pendingReroll に候補3つ）
 *     POST   /user/trunk/labels/{id}/reroll/choose { seed } → view
 *     PUT    /user/trunk/model { model }         → view
 *     PUT    /user/trunk/settings { receiveLabels } → view
 *
 * 失敗は `{ error, code }`（`code` は英字の印: notFound / full / proOnly / pendingReroll /
 * noRerollsLeft / noPending / badSeed / badModel / badRequest）。
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");
    const route = event.routeKey;
    const id = event.pathParameters?.id;
    const now = new Date();
    try {
        const pro = isPro(await readProfileBits(uid), now.getTime());
        if (route === "GET /user/trunk") {
            const [rows, photos] = await Promise.all([
                readTrunkItem(uid),
                listMyPhotos(uid),
            ]);
            return ok({ ...view(parseTrunk(rows), pro, now), posts: countPosts(photos) });
        }
        if (route === "PUT /user/trunk/model") {
            const doc = await mutateTrunk(uid, pro, now, modelMutation(body(event).model));
            return ok(view(doc, pro, now));
        }
        if (route === "PUT /user/trunk/settings") {
            const doc = await mutateTrunk(uid, pro, now, settingsMutation(body(event).receiveLabels));
            return ok(view(doc, pro, now));
        }
        if (typeof id !== "string" || !LABEL_ID_RE.test(id)) return jsonError(400, "不正なリクエスト", "badRequest");
        let fn: Mutation;
        switch (route) {
            case "POST /user/trunk/labels/{id}/stick": fn = stickMutation(id); break;
            case "DELETE /user/trunk/labels/{id}": fn = removeMutation(id); break;
            case "POST /user/trunk/labels/{id}/reroll": {
                const seeds = Array.from({ length: REROLL_CANDIDATES }, () => newSeed());
                fn = rerollMutation(id, seeds);
                break;
            }
            case "POST /user/trunk/labels/{id}/reroll/choose": fn = chooseMutation(id, body(event).seed); break;
            default: return jsonError(404, "見つかりません", "notFound");
        }
        const doc = await mutateTrunk(uid, pro, now, fn);
        return ok(view(doc, pro, now));
    } catch (e) {
        if (e instanceof TrunkError) return jsonError(e.status, e.message, e.code);
        if (e instanceof UserListError) return jsonError(503, "混み合っています。もう一度お試しください", "busy");
        console.error(`trunk(${route}) error:`, e);
        return jsonError(500, "処理に失敗しました");
    }
};

/** 行をそのまま読む（`readUserRows` は `list` だけを見るので、ここは Get を直に打つ） */
async function readTrunkItem(uid: string): Promise<Record<string, unknown> | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: trunkId(uid) } }));
    return res.Item as Record<string, unknown> | undefined;
}

function ok(payload: unknown) {
    return { statusCode: 200, headers: NO_STORE, body: JSON.stringify(payload) };
}
