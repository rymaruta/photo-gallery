import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, randomInt } from "crypto";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import { requireEnv } from "./env";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { listMyPhotos } from "./ddb-photos";
import { UserListError } from "./userList";
import { isPro, publicSupporter, sanitizeBadges } from "./badgeKeys";
import { isBlocked } from "./blockCheck";
import { isUserId } from "./userId";
import { isDeletedProfile } from "./types";
import { profileImageExists, type ProfileImageKind } from "./profileImage";
import { coordsOf, countryOfText, isCountablePhoto, seasonOf, yearMonthOf } from "./badges";
import { isPublicListPhoto } from "./feed";
import { countPublicPosts, placeKey, placeOf, placeOkFor, placeOkMayChange } from "./trunkPlace";
import type { Photo } from "./types";
import { PARTS_BY_RARITY, partOf, rarityOfRoll, type PartKind, type TrunkPart } from "./trunkParts";
import { goneIfDeleted } from "./liveCaller";

/**
 * 旅のトランク（iOS の新機能・2026-10-17 owner 承認）。
 *
 * 公開した投稿1件ごとにラベルを1枚「手持ち（pocket）」に配り、本人がトランクに
 * 「貼る（stuck）」。**絵は保存しない**——アプリが `seed` と `kind` から描く。
 *
 * ## 持ち方
 *
 * photos テーブルの2行（`updateTrunk`＝2行を読む → それぞれ rev 条件の TransactWriteItems で一度に書く）:
 *
 *     trunk#<uid>        持ち物（型・ラベル・設定・硬貨・部品・かけら・付けた部品）
 *     trunkledger#<uid>  悪用の歯止めの台帳（dealt・groups・milestones・coinLog・daily）
 *
 * 2026-10-17 判断（coordinator の指示）: 1行のままだと最大の行が 400KB の手前 1.7KB まで来たので、台帳を分けた。
 * **古い形**（台帳が trunk# の中にある行・台帳の行が無い）も読み、次に書くときに2行へ分ける。
 * 権限は今の共有ロールの PutItem・ConditionCheckItem・GetItem で足りる（BatchGetItem は持たないので、読みは Get を並べる）。
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
 *     daily          { day: 日本時間の YYYY-MM-DD, count }（その日に配った投稿の数＝ラベルか硬貨を配った数）
 *     coins          硬貨の枚数（0〜99）。公開の投稿1件につき1枚（2026-10-17 次の版）
 *     coinLog[]      24時間以内に硬貨を配った投稿 { k: 写真の id か束の鍵, a: 秒 }（取り消し用・古いものは書くたびに落とす）
 *     parts[]        持っている部品の id（`trunkParts.ts`・新しい順）
 *     fragments      かけらの数（ガチャで持っている部品が出たら +1・5つで交換）
 *     equipped       付けている部品 { handle, corner, lock, lining, tag, charm, key, pins[≤3], patches[≤2] }
 *     showTrunk      ほかの人にトランクを見せるか（既定 true・2026-10-18 owner「他の人のトランクの中身とか見れたら楽しい」）
 *     ticket         わたしの乗車券 { photoId, note, origin, destination, face, showsFrom }（人のトランクの中に出す1枚・無ければ項目ごと無い）
 *     posts          公開している投稿の数の控え（人のトランクの古び方に使う。本人が開いた・投稿したときに書く）
 *     welcomeCoinsAt はじめての硬貨を配った時刻（一度きり・`POST /user/trunk/welcome`）。welcomeCoinsAdded は足せた枚数
 *     welcomeCheckedAt 対象外と確かめた時刻（2回目からは読むだけにする）
 *     rewardAvatarAt / rewardCoverAt  アイコン／カバーを初めて設定したお礼を配った時刻（一度きり・`POST /user/trunk/reward`・#304）。
 *                    rewardAvatarAdded / rewardCoverAdded は足せた枚数
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
 * - 貼ったラベルは置き場 `pos` { x, y, rot } を持てる（x・y はトランク正面の 0〜1・rot は -30〜30 度）。
 *   無ければアプリがおまかせで置く。はがすと手持ちに戻り、置き場は消える
 * - **硬貨**（2026-10-17 次の版）: ラベルと同じ歯止め（指紋・束・1日3件・notNew）を通った投稿に1枚。
 *   **手持ちがいっぱいでも・受け取らない設定でも配る**（受け取らない設定はラベルのこと）。上限 99 枚。
 *   お金では買えない。24時間以内の削除・非公開で取り消し（まだ持っていれば1枚減らす。0 枚なら何もしない）
 * - ガチャは硬貨1枚。段（70/25/5%）→ その段の部品から等確率。持っていれば「かけら」+1。かけら5つで交換
 */

const USERS_TABLE = requireEnv("USERS_TABLE");

export const trunkId = (uid: string) => `trunk#${uid}`;
export const trunkLedgerId = (uid: string) => `trunkledger#${uid}`;
/** 台帳の行に置く項目（古い形では trunk# の中にある） */
const LEDGER_KEYS = ["dealt", "groups", "milestones", "coinLog", "daily"] as const;

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
 * 1行の大きさの上限（DynamoDB の1項目は 400KB）。
 * 見積もり（`trunk.test.ts` の「いちばん大きい行」で実測して確かめる）:
 *   ラベル 1350 枚（手持ち150＋貼った1200）× 約190B（短い鍵で保存・`stored`）≈ 250KB
 *   ＋ 指紋の台帳 3000 × 約17B ≈ 50KB ＋ 束の台帳 3000 × 約17B ≈ 50KB ＋ 節目の記録 ≈ 数KB
 *   ＝ およそ 350KB（JSON で数えた値。DynamoDB の数え方はこれより小さい）。
 *   ＋ 次の版（2026-10-17）: 貼った 1200 枚の置き場（`p` の整数3つ・1枚 約20B）≈ 24KB ＋ 部品 108 個 ≈ 1.4KB ＋
 *   付けた部品・かけら・硬貨・硬貨の控え ≈ 1KB。1行のままでは実測 387,356B で、予算の残りが 1.7KB しかなかった。
 *   → **台帳を `trunkledger#<uid>` に分けた**（`updateTrunk`）。予算は行ごとに見る。分けたあとの実測（`trunk.test.ts`）:
 *       trunk#        いちばん大きい行 283,408B（残り 105,712B）
 *       trunkledger#  いちばん大きい行 120,268B（指紋3000・束3000・節目300・控え20／残り 268,852B）
 *   ふつうの鍵のまま（1枚 約280B）だと 470KB で入らなかった
 *   ⚠️ 地名を長く書く人では越えうる。そのときは配らない・貼らない（黙って切り詰めない）
 * （2026-10-17 判断: 越えるなら配らない（`storage`）・貼らない（409 `storage`）。黙って切り詰めない）
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
/**
 * ラベル（と硬貨）を配る線: **これより前に作られた写真には配らない**（昔の写真を非公開 → 公開にして
 * 集められないように）。savePhoto のその場の投稿は新しいので当たらない。
 *
 * **本番は日本時間 2026-10-17 0:00 のこの値で出た**（main bf288b7）。本番へのマージは 10/18 になったが、
 * 10/17 に作った写真は許す（2026-10-17 判断・coordinator）。線を後ろへずらすと、10/17 に作った写真が
 * 後から対象外になるので**この値は動かさない**
 */
export const TRUNK_LAUNCHED_AT = "2026-10-16T15:00:00.000Z";
export const REVOKE_WINDOW_MS = 24 * 3_600_000;
export const DEALT_LEDGER_MAX = 3000;
/**
 * 配った節目の記録の上限（節目4つ＋国ごとの「はじめての国」）。国の数より十分大きく取る。
 * 束（`groups`）の台帳は指紋の台帳と同じ 3000 件・古い順に落とす（2026-10-17 判断）
 */
export const MILESTONE_LEDGER_MAX = 300;

/** 硬貨の上限（超えたら配らない・2026-10-17 owner） */
export const COINS_MAX = 99;
/**
 * はじめての硬貨（2026-10-18 owner 承認）: 硬貨が始まる前から居る利用者に一度だけ配る枚数
 */
export const WELCOME_COINS = 10;
/**
 * アイコン・カバーを初めて設定したお礼（#304・2026-10-18 owner「3枚ずつ」）。それぞれ一度きり
 */
export const REWARD_COINS = 3;
/**
 * 硬貨の機能が本番に出た時刻。**これより前に登録した人**が「はじめての硬貨」の対象。
 * 出典: photo-gallery #393 のマージ（62bc9a54）を本番に出した Deploy API Lambdas
 * （run 39079109521・main）の完了時刻 `updated_at`（開始は 2026-10-17T23:27:39Z）
 */
export const TRUNK_COINS_LAUNCHED_AT = "2026-10-17T23:32:10.000Z";
/** 交換に要るかけらの数 */
export const FRAGMENTS_PER_EXCHANGE = 5;
/** 付けられる数（ピンバッジ・ワッペン） */
export const PINS_MAX = 3;
export const PATCHES_MAX = 2;
/** 1つずつ付ける部品の場所（ピンバッジとワッペンは並びで持つ） */
export const SINGLE_SLOTS = ["handle", "corner", "lock", "lining", "tag", "charm", "key"] as const;
export type SingleSlot = (typeof SINGLE_SLOTS)[number];
/**
 * 硬貨の取り消しの控え（`coinLog`）の上限。24時間より古いものは書くたびに落とすので、1日3件の
 * 歯止めのもとでは多くても6件ほど。念のための上限
 */
const COIN_LOG_MAX = 20;
/** 置き場の傾きの範囲（度） */
export const ROT_MAX = 30;

/** 本流（savePhoto）の中で待ってよい上限。メダルの数え直し（`badgeStore.ts` の QUIET_LIMIT_MS）と同じ */
export const TRUNK_QUIET_LIMIT_MS = 2500;


export const LABEL_KINDS = ["milestone", "timeslot", "season", "place"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export const TIMESLOTS = ["dawn", "dusk", "night"] as const;
export const MILESTONES = ["first", "posts10", "posts50", "posts100", "firstCountry"] as const;

/**
 * ラベル1枚。**保存するときは `photoId` を持たない**（いつも `id` と同じなので、1行を小さく保つ・
 * 2026-10-17 判断）。読むときに `id` から埋める
 */
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
     * **1投稿＝1枚**にするため、配るときの見分けに持つ（応答には出さない）。
     * 保存するのは `groupId` そのものではなく短いハッシュ（`g:` ＋12桁）——束の台帳（`groups`）も同じ値
     */
    groupId?: string;
    /**
     * 貼った置き場（貼ったラベルだけ・無ければおまかせ）。2026-10-17 判断: x・y は小数3桁、rot は小数1桁に
     * 丸めて保存する（1200 枚に持たせても1行が 400KB を越えないように・`stored` の `p`）
     */
    pos?: TrunkPos;
    /**
     * **地名を人に見せてよいと確かめた印**（2026-10-18 coordinator 判断「確かめた物だけ見せる」・`trunkPlace.ts`）。
     * 誰にでも見える公開の写真から来て、撮影地が今もラベルと同じときだけ付く。人の口（`theirLabel`）は
     * この印のあるラベルだけ地名と手がかりを出す。非公開・削除・絞る・撮影地の変更で外し、戻せば付け直す
     */
    placeOk?: true;
};

export type TrunkPos = { x: number; y: number; rot: number };

export type Equipped = { [K in SingleSlot]?: string } & { pins: string[]; patches: string[] };

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
    /** 配った節目（`first`・`posts10`…・`firstCountry:<国>`）。一度きり。写真を消しても消さない */
    milestones: string[];
    /** 配った束（写真の `groupId`）。手持ちから消しても残す（同じ束の別の写真に配らない） */
    groups: string[];
    coins: number;
    /** 24時間以内に硬貨を配った投稿（取り消し用）。`a` は秒 */
    coinLog: { k: string; a: number }[];
    parts: string[];
    fragments: number;
    equipped: Equipped;
    /** ほかの人に見せるか（既定 true） */
    showTrunk: boolean;
    /** わたしの乗車券（`PUT /user/trunk/settings` の `ticket`）。無ければ undefined */
    ticket?: TrunkTicket;
    /**
     * 公開している投稿の数の控え（`countPosts`）。**人のトランクの古び方だけに使う**——人の写真を全部
     * 読まずに済むように、本人が `GET /user/trunk` を開いたときと投稿したとき（`grantLabel`）に書く。
     * 書いたことが無ければ undefined（人の口は項目ごと出さない）
     */
    posts?: number;
    /** はじめての硬貨を配った時刻（一度きり） */
    welcomeCoinsAt?: string;
    /** はじめての硬貨で足せた枚数（上限 99 で 10 より少ないことがある） */
    welcomeCoinsAdded?: number;
    /** はじめての硬貨の対象外と確かめた時刻 */
    welcomeCheckedAt?: string;
    // #304（2026-10-18）: アイコン・カバーのお礼の印。**トランク担当の項目と同じ型・parseTrunk・serializeRows に
    // 足すので、足すのはこの4つと読み書きの各2行だけ**（ほかの項目の形は変えない）
    /** アイコンのお礼を配った時刻（一度きり。0 枚でも立てる） */
    rewardAvatarAt?: string;
    /** アイコンのお礼で足せた枚数 */
    rewardAvatarAdded?: number;
    /** カバーのお礼を配った時刻（一度きり。0 枚でも立てる） */
    rewardCoverAt?: string;
    /** カバーのお礼で足せた枚数 */
    rewardCoverAdded?: number;
};

/**
 * わたしの乗車券（iOS のすれちがいで交換する本人の1枚・`PassSettings`）。2026-10-18 判断: 今まで端末の中に
 * だけあったので、人のトランクの中に出すためにここへ置く（iOS が `PUT /user/trunk/settings` で送る）。
 * 写真は**本人の公開写真だけ**（置くときと読むときの両方で見る）。字の上限は iOS の `PassExchange` と同じ
 */
export type TrunkTicket = {
    photoId: string;
    /** 裏に書くひとこと（20字・80バイトまで・改行なし） */
    note: string;
    /** 「発」を自分で書いた字（空なら自動。6字・24バイトまで） */
    origin: string;
    /** 「着」を自分で書いた字（空なら自動。6字・24バイトまで） */
    destination: string;
    /** 券面の電波の番号（0 はマルス券・ほかは Pro だけ。人の口では Pro でなければ 0 にする） */
    face: number;
    /** 「発」に居住地の都道府県を出してよいか */
    showsFrom: boolean;
};

export const TICKET_NOTE_MAX = 20;
export const TICKET_NOTE_BYTES = 80;
export const TICKET_LABEL_MAX = 6;
export const TICKET_LABEL_BYTES = 24;
const PHOTO_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

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
 * **撮影日時が無ければ写真 id の指紋**（機種と大きさだけだと、同じカメラの別の写真がみな同じ指紋になる）。
 * アップロードの処理は中身のハッシュを持っていない（presign で長さを縛るだけで、S3 の ETag を
 * 読むには HeadObject の権限が要る＝IAM の変更になる）ので使わない。
 * 撮影日時の無い写真（スクリーンショット・EXIF を落とした書き出し）は**写真 id だけ**で見る
 * ——上げ直せば別の id になるので、その写真は消して上げ直すと届く（日の上限3枚が歯止め）。
 * ⚠️ 同じ秒・同じ機種・同じ大きさの連写は同じ指紋になる（2枚目は `duplicate`）。それは許す
 */
export function fingerprintOf(p: Photo): string {
    const e = p.exif ?? {};
    const parts = [e.dateTimeOriginal, e.camera, e.imageSize].map((v) => (typeof v === "string" ? v.trim() : ""));
    // 台帳を小さく保つため、id だけの指紋も同じ長さに縮める（`i:` と `x:` で混ざらない）
    if (parts[0] === "") return `i:${shortHash(p.id)}`;
    return `x:${shortHash(parts.join("\u0000"))}`;
}

function shortHash(v: string): string {
    return createHash("sha256").update(v).digest("hex").slice(0, 12);
}

const strings = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];

/** 行（無ければ undefined）を、使ってよい形に読み直す */
/**
 * 行（無ければ undefined）を、使ってよい形に読み直す。
 * 台帳は `ledger`（`trunkledger#` の行）が在ればそこから、無ければ古い形として `item` の中から読む
 */
export function parseTrunk(item: Record<string, unknown> | undefined, ledger?: Record<string, unknown>): TrunkDoc {
    const lg = ledger ?? item;
    const labels = (v: unknown) => Array.isArray(v)
        ? (v as unknown[]).map(decodeLabel).filter(isTrunkLabel).map((l) => ({ ...l, photoId: l.id }))
        : [];
    const r = item?.rerolls as { month?: unknown; used?: unknown } | undefined;
    const parts = [...new Set(strings(item?.parts).filter((id) => !!partOf(id)))];
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
        dealt: strings(lg?.dealt),
        milestones: strings(lg?.milestones),
        groups: strings(lg?.groups),
        daily: {
            day: typeof (lg?.daily as { day?: unknown })?.day === "string" ? (lg!.daily as { day: string }).day : "",
            count: typeof (lg?.daily as { count?: unknown })?.count === "number" ? (lg!.daily as { count: number }).count : 0,
        },
        coins: Math.min(COINS_MAX, count(item?.coins)),
        coinLog: Array.isArray(lg?.coinLog)
            ? (lg!.coinLog as unknown[]).filter((e): e is { k: string; a: number } =>
                !!e && typeof e === "object" && typeof (e as { k?: unknown }).k === "string"
                && typeof (e as { a?: unknown }).a === "number")
                .map((e) => ({ k: e.k, a: e.a }))
            : [],
        parts,
        fragments: count(item?.fragments),
        equipped: parseEquipped(item?.equipped, new Set(parts)),
        showTrunk: item?.showTrunk !== false,
        ...(storedTicket(item?.ticket) ? { ticket: storedTicket(item?.ticket) } : {}),
        ...(isCount(item?.posts) ? { posts: item!.posts as number } : {}),
        ...(typeof item?.welcomeCoinsAt === "string" ? { welcomeCoinsAt: item.welcomeCoinsAt } : {}),
        ...(typeof item?.welcomeCoinsAdded === "number" ? { welcomeCoinsAdded: count(item.welcomeCoinsAdded) } : {}),
        ...(typeof item?.welcomeCheckedAt === "string" ? { welcomeCheckedAt: item.welcomeCheckedAt } : {}),
        // #304 のお礼の印（最小限の足し・`TrunkDoc` の注記）
        ...(typeof item?.rewardAvatarAt === "string" ? { rewardAvatarAt: item.rewardAvatarAt, rewardAvatarAdded: count(item.rewardAvatarAdded) } : {}),
        ...(typeof item?.rewardCoverAt === "string" ? { rewardCoverAt: item.rewardCoverAt, rewardCoverAdded: count(item.rewardCoverAdded) } : {}),
    };
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** 保存されている乗車券を読む（形の違うものは無いことにする） */
function storedTicket(v: unknown): TrunkTicket | undefined {
    if (!v || typeof v !== "object") return undefined;
    const t = v as Record<string, unknown>;
    if (typeof t.photoId !== "string" || !PHOTO_ID_RE.test(t.photoId)) return undefined;
    const str = (x: unknown) => (typeof x === "string" ? x : "");
    return {
        photoId: t.photoId,
        note: str(t.note),
        origin: str(t.origin),
        destination: str(t.destination),
        face: typeof t.face === "number" && Number.isInteger(t.face) && t.face >= 0 && t.face <= 255 ? t.face : 0,
        showsFrom: t.showsFrom !== false,
    };
}

/** 字を整える: 改行・制御文字を落として前後の空白を取る。上限を越えたら null（切り詰めない） */
function cleanTicketText(v: unknown, maxChars: number, maxBytes: number): string | null {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") return null;
    const s = v.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, "").trim();
    if ([...s].length > maxChars || Buffer.byteLength(s, "utf8") > maxBytes) return null;
    return s;
}

/**
 * 本文の乗車券を読む（`PUT /user/trunk/settings` の `ticket`）。`null` は外す（undefined を返す）。
 * 形が違えば 400 `badTicket`。写真が本人の公開写真かは口で確かめる（`isOwnPublicPhoto`）
 */
export function parseTicket(v: unknown): TrunkTicket | undefined {
    if (v === null) return undefined;
    const bad = () => new TrunkError(400, "乗車券が正しくありません", "badTicket");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw bad();
    const t = v as Record<string, unknown>;
    if (typeof t.photoId !== "string" || !PHOTO_ID_RE.test(t.photoId) || t.photoId.includes("#")) throw bad();
    const note = cleanTicketText(t.note, TICKET_NOTE_MAX, TICKET_NOTE_BYTES);
    const origin = cleanTicketText(t.origin, TICKET_LABEL_MAX, TICKET_LABEL_BYTES);
    const destination = cleanTicketText(t.destination, TICKET_LABEL_MAX, TICKET_LABEL_BYTES);
    if (note === null || origin === null || destination === null) throw bad();
    const face = t.face === undefined || t.face === null ? 0 : t.face;
    if (typeof face !== "number" || !Number.isInteger(face) || face < 0 || face > 255) throw bad();
    if (t.showsFrom !== undefined && typeof t.showsFrom !== "boolean") throw bad();
    return { photoId: t.photoId, note, origin, destination, face, showsFrom: t.showsFrom !== false };
}

/**
 * 本人の・誰にでも見える公開の写真か（下書き・ストーリー・公開範囲を絞った写真・ほかの人の写真は違う）。
 * 判定は公開の一覧と同じ `feed.ts` の `isPublicListPhoto`（写さない）
 */
export function isOwnPublicPhoto(row: Record<string, unknown> | undefined, uid: string): boolean {
    if (!row) return false;
    return (row.userId ?? row.uploadedBy) === uid && isPublicListPhoto(row);
}

/** 0 以上の整数（違えば 0） */
const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

/** 付けている部品を読み直す。持っていない・kind の合わない・知らない id は落とす */
function parseEquipped(v: unknown, owned: Set<string>): Equipped {
    const e = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const fits = (id: unknown, kind: PartKind): id is string => partOf(id)?.kind === kind && owned.has(id as string);
    const out: Equipped = { pins: [], patches: [] };
    for (const slot of SINGLE_SLOTS) if (fits(e[slot], slot)) out[slot] = e[slot] as string;
    out.pins = [...new Set(strings(e.pins).filter((id) => fits(id, "pin")))].slice(0, PINS_MAX);
    out.patches = [...new Set(strings(e.patches).filter((id) => fits(id, "patch")))].slice(0, PATCHES_MAX);
    return out;
}

/** 書く項目を2行に分ける（`updateTrunk` が id・uid・rev・updatedAt を足す） */
function serializeRows(doc: TrunkDoc): { main: Record<string, unknown>; ledger: Record<string, unknown> } {
    return {
        main: {
            model: doc.model,
            lastFreeModel: doc.lastFreeModel,
            pocket: doc.pocket.map(stored),
            stuck: doc.stuck.map(stored),
            rerolls: doc.rerolls,
            ...(doc.pendingReroll ? { pendingReroll: doc.pendingReroll } : {}),
            receiveLabels: doc.receiveLabels,
            coins: doc.coins,
            parts: doc.parts,
            fragments: doc.fragments,
            equipped: compactEquipped(doc.equipped),
            showTrunk: doc.showTrunk,
            ...(doc.ticket ? { ticket: doc.ticket } : {}),
            ...(doc.posts !== undefined ? { posts: doc.posts } : {}),
            ...(doc.welcomeCoinsAt ? { welcomeCoinsAt: doc.welcomeCoinsAt } : {}),
            ...(doc.welcomeCoinsAdded !== undefined ? { welcomeCoinsAdded: doc.welcomeCoinsAdded } : {}),
            ...(doc.welcomeCheckedAt ? { welcomeCheckedAt: doc.welcomeCheckedAt } : {}),
            // #304 のお礼の印（最小限の足し・`TrunkDoc` の注記）
            ...(doc.rewardAvatarAt ? { rewardAvatarAt: doc.rewardAvatarAt, rewardAvatarAdded: doc.rewardAvatarAdded ?? 0 } : {}),
            ...(doc.rewardCoverAt ? { rewardCoverAt: doc.rewardCoverAt, rewardCoverAdded: doc.rewardCoverAdded ?? 0 } : {}),
        },
        ledger: {
            dealt: doc.dealt.slice(0, DEALT_LEDGER_MAX),
            daily: doc.daily,
            milestones: doc.milestones.slice(0, MILESTONE_LEDGER_MAX),
            groups: doc.groups.slice(0, DEALT_LEDGER_MAX),
            coinLog: doc.coinLog.slice(0, COIN_LOG_MAX),
        },
    };
}

/** 空の場所は書かない（1行を小さく保つ） */
function compactEquipped(e: Equipped): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const slot of SINGLE_SLOTS) if (e[slot]) out[slot] = e[slot];
    if (e.pins.length) out.pins = e.pins;
    if (e.patches.length) out.patches = e.patches;
    return out;
}

/**
 * **保存する形（短い鍵）**。2026-10-17 判断: 1行に 1350 枚＋台帳を入れると、ふつうの形
 * （1枚およそ 280B）では 400KB を越える（`trunk.test.ts` の「いちばん大きい行」で実測）。
 * 鍵を1文字にし、時刻を秒の数、季節・時刻・kind を短い印にして、1枚およそ 190B にする。
 * `photoId` は `id` と同じなので持たない。読むとき（`decodeLabel`）に元の形へ戻す
 *
 *     i id ・ k kind(m/t/s/p) ・ n 地名 ・ l latin ・ c 国 ・ s 季節(0-3) ・ t 時刻(0-2) ・
 *     m 節目 ・ d seed ・ a 時刻(秒) ・ f foil(1) ・ g 束の鍵 ・ o 地名を人に見せてよい(1) ・
 *     p 置き場 [x×1000, y×1000, rot×10]（整数）
 */
const KIND_CODE: Record<LabelKind, string> = { milestone: "m", timeslot: "t", season: "s", place: "p" };
const KIND_BY_CODE: Record<string, LabelKind> = { m: "milestone", t: "timeslot", s: "season", p: "place" };

function stored(l: TrunkLabel): Record<string, unknown> {
    const at = Date.parse(l.at);
    return {
        i: l.id,
        k: KIND_CODE[l.kind],
        n: l.place.name,
        ...(l.place.latin ? { l: l.place.latin } : {}),
        ...(l.place.country ? { c: l.place.country } : {}),
        ...(l.season ? { s: SEASONS.indexOf(l.season) } : {}),
        ...(l.timeslot ? { t: TIMESLOTS.indexOf(l.timeslot) } : {}),
        ...(l.milestone ? { m: l.milestone } : {}),
        d: l.seed,
        a: Number.isFinite(at) ? Math.floor(at / 1000) : 0,
        ...(l.foil ? { f: 1 } : {}),
        ...(l.groupId ? { g: l.groupId } : {}),
        ...(l.placeOk ? { o: 1 } : {}),
        ...(l.pos ? { p: [Math.round(l.pos.x * 1000), Math.round(l.pos.y * 1000), Math.round(l.pos.rot * 10)] } : {}),
    };
}

/** 保存の形から元の形へ（短い鍵でない値＝元の形のまま書かれた行は、そのまま渡す） */
function decodeLabel(v: unknown): unknown {
    if (!v || typeof v !== "object" || typeof (v as { i?: unknown }).i !== "string") return v;
    const r = v as Record<string, unknown>;
    const season = typeof r.s === "number" ? SEASONS[r.s] : undefined;
    const timeslot = typeof r.t === "number" ? TIMESLOTS[r.t] : undefined;
    return {
        id: r.i,
        kind: typeof r.k === "string" ? KIND_BY_CODE[r.k] : undefined,
        place: {
            name: typeof r.n === "string" ? r.n : "",
            ...(typeof r.l === "string" ? { latin: r.l } : {}),
            ...(typeof r.c === "string" ? { country: r.c } : {}),
        },
        ...(season ? { season } : {}),
        ...(timeslot ? { timeslot } : {}),
        ...(isIn(MILESTONES, r.m) ? { milestone: r.m } : {}),
        seed: r.d,
        at: typeof r.a === "number" ? new Date(r.a * 1000).toISOString() : "",
        ...(r.f === 1 ? { foil: true } : {}),
        ...(typeof r.g === "string" ? { groupId: r.g } : {}),
        ...(r.o === 1 ? { placeOk: true } : {}),
        ...(posOfStored(r.p) ? { pos: posOfStored(r.p) } : {}),
    };
}

function posOfStored(v: unknown): TrunkPos | undefined {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
    const pos = { x: v[0] / 1000, y: v[1] / 1000, rot: v[2] / 10 };
    return isPos(pos) ? pos : undefined;
}

const isPos = (p: TrunkPos) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && p.rot >= -ROT_MAX && p.rot <= ROT_MAX;

/**
 * 本文の置き場を読む。x・y・rot のどれも無ければ undefined（おまかせ）。
 * 1つでもあれば3つとも要る（数で・範囲の内）。違えば 400 `badPlace`。保存の細かさに丸めて返す
 */
export function parsePos(b: Record<string, unknown>): TrunkPos | undefined {
    if (b.x === undefined && b.y === undefined && b.rot === undefined) return undefined;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const pos = { x: num(b.x), y: num(b.y), rot: num(b.rot) };
    if (![pos.x, pos.y, pos.rot].every(Number.isFinite) || !isPos(pos)) {
        throw new TrunkError(400, "置き場が正しくありません", "badPlace");
    }
    return { x: Math.round(pos.x * 1000) / 1000, y: Math.round(pos.y * 1000) / 1000, rot: Math.round(pos.rot * 10) / 10 };
}

/** 2行の大きさ（JSON で数えたバイト数）。テストが最大の行を実測するのにも使う */
export function rowSizes(doc: TrunkDoc): { main: number; ledger: number } {
    const rows = serializeRows(doc);
    return {
        main: Buffer.byteLength(JSON.stringify(rows.main), "utf8"),
        ledger: Buffer.byteLength(JSON.stringify(rows.ledger), "utf8"),
    };
}

const fitsBudget = (doc: TrunkDoc) => {
    const z = rowSizes(doc);
    return z.main <= TRUNK_BUDGET_BYTES && z.ledger <= TRUNK_BUDGET_BYTES;
};

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

/** 土地（`trunkPlace.ts` に移した。人の口の判定と台本が同じ関数を使う） */
export { placeOf } from "./trunkPlace";

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
        // 秒にそろえる（保存の形が秒で持つので、再送で返す配り済みの1枚と同じ値になる）
        at: new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString(),
        ...(rand(0, 10_000) < FOIL_PER_10000 ? { foil: true as const } : {}),
        ...(g ? { groupId: groupKey(g) } : {}),
    };
}

/** 束の見分けに使う短い鍵（`groupId` は最大64文字。台帳を小さく保つ） */
export const groupKey = (groupId: string) => `g:${shortHash(groupId.trim())}`;

// ─── 配る ───────────────────────────────────────────────────

export type DealOutcome = {
    /** 応答に出す形（`stripInternal` を通したもの。束の鍵は出さない） */
    label: PublicLabel | null;
    labelSkipped?: "draft" | "notNew" | "off" | "duplicate" | "daily" | "full" | "storage" | "samePost" | "timeout" | "error"
        // 退会した人（墓石）。保存の口が先に 410 で止めるので、ふつうは応答に出ない
        | "deleted";
    /** この投稿で配った硬貨の枚数（0 か 1）。savePhoto・写真の編集の応答にそのまま載る */
    coin: 0 | 1;
};

/** 配らなかったときの形 */
export const noDeal = (labelSkipped: DealOutcome["labelSkipped"]): DealOutcome => ({ label: null, labelSkipped, coin: 0 });

/** 硬貨の取り消しの控えの鍵（束なら束の鍵＝`g:`、そうでなければ写真の id。id は `:` を持たないので混ざらない） */
const coinKeyOf = (l: TrunkLabel) => l.groupId ?? l.id;

/** 24時間を過ぎた控えを落とす */
const freshCoinLog = (log: TrunkDoc["coinLog"], now: Date) =>
    log.filter((e) => now.getTime() - e.a * 1000 <= REVOKE_WINDOW_MS);

/**
 * 手持ちに足す・硬貨を配る（純関数）。**変えないときは doc: null**。
 * この順に見る:
 * - 同じ id が手持ちか貼った方に在る → そのラベルを返す（再送・非公開→公開で二度配らない・硬貨も 0）
 * - 同じ束の投稿に配り済み → 配らない（`samePost`）
 * - 指紋が台帳に在る（消して上げ直した・前に配って手持ちから削除した）→ 配らない（`duplicate`）
 * - その日に3件配った → 配らない（`daily`）
 * ここまでがラベルと硬貨に共通の歯止め。通った投稿には:
 * - 硬貨を1枚（99 枚なら配らない）。**受け取らない設定・手持ちがいっぱいでも配る**
 * - ラベルを1枚。受け取らない設定 → `off`・手持ちが上限 → `full`（貼ったものは数えない）
 * どちらか1つでも配れたら、指紋・束・日の数を台帳に載せる（2026-10-17 判断: 硬貨だけ配った投稿も
 * 「報いを受け取った投稿」として台帳に載せる。載せないと、受け取らない設定のまま消して上げ直すと
 * 硬貨を何度でも集められる）。どちらも配れなければ何も書かない（今までの `full` と同じ）。
 * 受け取らない設定のときは、ラベルの理由はいつも `off`（歯止めで止まったときも・今までの返し方のまま）
 */
export function dealInto(
    doc: TrunkDoc, label: TrunkLabel, limit: number, fingerprint: string, now: Date,
    opts: { siblingPlaces?: Set<string> } = {},
): { doc: TrunkDoc | null; outcome: DealOutcome } {
    const existing = doc.pocket.find((l) => l.id === label.id) ?? doc.stuck.find((l) => l.id === label.id);
    if (existing) {
        // 配り済みの写真がまた来た（再送）: 地名を見せてよいかを、今の写真で付け直す（同じ書き込み）。決まりは `placeOkNext`:
        // 付けるのは今の写真が誰にでも見える公開で（`label.placeOk`）撮影地がラベルと同じとき。束の兄弟（強い読み・
        // `siblingPlaces`。再送の束だけ `grantLabel` が読む）は残す根拠にだけなる
        const self = !!label.placeOk && placeKey(existing.place) === placeKey(label.place);
        const ok = self || (!!existing.placeOk && !!opts.siblingPlaces?.has(placeKey(existing.place)));
        const next = setPlaceOk(doc, (l) => l.id === label.id, () => ok);
        const shown = next ? (next.pocket.find((l) => l.id === label.id) ?? next.stuck.find((l) => l.id === label.id)!) : existing;
        return { doc: next, outcome: { label: stripInternal(shown), coin: 0 } };
    }
    const skip = (why: DealOutcome["labelSkipped"]) => ({ doc: null, outcome: noDeal(doc.receiveLabels ? why : "off") });
    // 束は台帳で見る（手持ちから消しても、同じ束の別の写真には配らない）。台帳を入れる前に配った分は手持ち・貼った方で見る
    if (label.groupId && (doc.groups.includes(label.groupId)
        || [...doc.pocket, ...doc.stuck].some((l) => l.groupId === label.groupId))) {
        return skip("samePost");
    }
    // 台帳は配ったときに必ず載る＝手持ちから削除したあとの再送でも、消して上げ直しても戻らない
    if (doc.dealt.includes(fingerprint)) return skip("duplicate");
    const day = jstDay(now);
    const todayCount = doc.daily.day === day ? doc.daily.count : 0;
    if (todayCount >= DAILY_DEAL_MAX) return skip("daily");

    const coin: 0 | 1 = doc.coins < COINS_MAX ? 1 : 0;
    let labelSkipped: DealOutcome["labelSkipped"] = !doc.receiveLabels ? "off"
        : doc.pocket.length >= limit ? "full" : undefined;
    if (labelSkipped && !coin) return { doc: null, outcome: noDeal(labelSkipped) };

    const base: TrunkDoc = {
        ...doc,
        dealt: [fingerprint, ...doc.dealt],   // 上限（古い順に落とす）は serialize で切る
        daily: { day, count: todayCount + 1 },
        ...(label.groupId ? { groups: [label.groupId, ...doc.groups] } : {}),
        ...(coin ? {
            coins: doc.coins + 1,
            coinLog: [{ k: coinKeyOf(label), a: Math.floor(now.getTime() / 1000) }, ...freshCoinLog(doc.coinLog, now)],
        } : {}),
    };
    if (!labelSkipped) {
        // **節目は一度きり**（写真を全部消して投稿し直しても、同じ節目は二度と配らない）。
        // 配り済みなら節目を外し、残りの順（時刻 ＞ 季節 ＞ 土地）で kind を決め直す
        const msKey = milestoneKey(label);
        const given = msKey !== null && doc.milestones.includes(msKey) ? withoutMilestone(label) : label;
        const next: TrunkDoc = {
            ...base,
            pocket: [given, ...doc.pocket],
            ...(given.milestone && msKey ? { milestones: [msKey, ...doc.milestones] } : {}),
        };
        if (fitsBudget(next)) return { doc: next, outcome: { label: stripInternal(given), coin } };
        labelSkipped = "storage";
    }
    // ラベルは配れない。硬貨だけ配る（1行に入らなければ何も配らない）
    if (!coin || !fitsBudget(base)) return { doc: null, outcome: noDeal(labelSkipped) };
    return { doc: base, outcome: { label: null, labelSkipped, coin } };
}

/** 節目の記録の鍵。「はじめての国」は国ごと（`firstCountry:フランス`） */
export function milestoneKey(l: TrunkLabel): string | null {
    if (!l.milestone) return null;
    return l.milestone === "firstCountry" ? `firstCountry:${l.place.country ?? ""}` : l.milestone;
}

function withoutMilestone(l: TrunkLabel): TrunkLabel {
    const { milestone: _m, ...rest } = l;
    void _m;
    return { ...rest, kind: rest.timeslot ? "timeslot" : rest.season ? "season" : "place" };
}

/**
 * 本人の users の行（Pro の判定と墓石の印）。
 * 🔴 **`deletedAt` を射影から外さない。** 外すと墓石の印が返らず、`grantLabel` と口の
 * 退会の確かめ（`goneIfDeleted`）が常に「生きている」と読んで黙って死ぬ（`types.ts` の注記）
 */
async function readProfileBits(uid: string): Promise<Record<string, unknown> | undefined> {
    const res = await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: uid },
        ProjectionExpression: "userId, supporter, deletedAt",
    }));
    return res.Item as Record<string, unknown> | undefined;
}

/**
 * 公開した投稿にラベルを1枚配る。読む・書くで落ちたら投げる（`grantLabelQuietly` が握る）。
 * 下書き・ストーリーは配らない（メダルと同じ `isCountablePhoto` の線）。
 */
export async function grantLabel(
    uid: string, photo: Photo, now: Date = new Date(), rand: Rand = cryptoRand, photos?: Promise<Photo[]>,
    deadline?: number, opts: { resend?: boolean } = {},
): Promise<DealOutcome> {
    if (!uid || !isCountablePhoto(photo)) return noDeal("draft");
    // 本人の写真の一覧は、渡されたら使う（savePhoto がメダルの数え直しと1回の読みを分け合う）
    const [profile, mine] = await Promise.all([readProfileBits(uid), photos ?? listMyPhotos(uid)]);
    // **退会した人には配らない**（二重の守り）。保存の口（`savePhoto`）が先に 410 で止めるが、
    // 配りは `trunk#`・`trunkledger#` を作り直す——退会の掃除はもう走らないので、誰も消さない
    if (isDeletedProfile(profile)) return noDeal("deleted");
    const limit = pocketLimit(isPro(profile, now.getTime()));
    const key = postKey(photo);
    // この投稿（束なら束ごと）を除く。索引は結果整合なので、いま書いた行が見えていてもいなくても同じ数になる
    const others = mine.filter((o) => isCountablePhoto(o) && o.id !== photo.id && postKey(o) !== key);
    // 乱数は**書く前に1回だけ**引く（競合で読み直しても同じ1枚を足す）
    const built = buildLabel(photo, others, now, rand);
    // 地名を人に見せてよいのは、誰にでも見える公開の写真から配ったときだけ（絞った写真・下書きからの配りは伏せる）
    const label: TrunkLabel = isPublicListPhoto(photo as unknown as Record<string, unknown>) ? { ...built, placeOk: true } : built;
    const fp = fingerprintOf(photo);
    // 人のトランクの古び方に使う控え（この投稿を足した数）。**配って書くときに相乗りするだけ**——配らない回
    // （歯止め・上限）は今までどおり何も書かない。控えは本人が `GET /user/trunk` を開いたときにも直る
    const posts = countPublicPosts([...others, photo] as unknown as Record<string, unknown>[]);
    // 再送の束だけ: 配り済みのラベルの印を、強い読みの兄弟を根拠に残せるよう読む（`placeOkNext`）。
    // **読むのは要るときだけ**: 再送で、配り済みのラベル（印つき）に当たり、今の写真では印を残せないとき。
    // そのときは一度書かずに戻り、兄弟を並べて上限まで読んでから、もう一度配りを通す（trunk の読みが1回増える）。
    // 再送でない回は兄弟を読まない（束の2枚目以降は `samePost` で配り済みには当たらない＝見せない側に倒す）
    const g = typeof photo.groupId === "string" ? photo.groupId.trim() : "";
    let siblingPlaces: Set<string> | undefined;
    let outcome: DealOutcome = noDeal("error");
    let wroteOk = false;
    for (let pass = 0; pass < 2; pass++) {
        let needSiblings = false;
        await updateTrunk(uid, (doc) => {
            const existing = doc.pocket.find((l) => l.id === label.id) ?? doc.stuck.find((l) => l.id === label.id);
            const selfOk = !!label.placeOk && !!existing && placeKey(existing.place) === placeKey(label.place);
            if (opts.resend && g && siblingPlaces === undefined && existing?.placeOk && !selfOk) {
                needSiblings = true;
                return null;
            }
            needSiblings = false;
            const r = dealInto(doc, label, limit, fp, now, { siblingPlaces });
            outcome = r.outcome;
            // この書き込みで「地名を見せてよい」印を新しく付けたか（やり直しのたびに決め直す＝最後の1回が書いたもの）
            wroteOk = !!r.doc && hasPlaceOk(r.doc, label.id) && !hasPlaceOk(doc, label.id);
            return r.doc ? { ...r.doc, posts } : null;
        });
        if (!needSiblings) break;
        siblingPlaces = await strongSiblingPlaces(uid, g, photo.id, mine);
    }
    // **書いたあとに確かめる**: 書くまでのあいだ（競合のやり直し・Lambda の凍結）に写真が絞られた・非公開に
    // された・撮影地が変わったなら、付けた印を外し直す（外す側は確かめなくても漏れない）。
    // 2026-10-18 判断: 確かめは配りと**同じ待ちの内側**で、配りを書いたらすぐに走らせる。待ちの切れ目（`deadline`）が
    // 来たら確かめを待たずに配りの答えをそのまま返す（確かめは裏で続く）。確かめが落ちても記録だけ（配りの答えを
    // error にしない＝写真の編集が「初めての公開」の印を戻さない）。走りきらなかった（Lambda が止まった）ときの
    // 受け皿は、本人の `GET /user/trunk` の外し（`stalePlaceOkCandidates`）
    const kept = wroteOk ? await confirmWithin(uid, photo.id, deadline) : true;
    if (!kept && outcome.label) {
        // 外し直したら、応答の1枚も印なしにする（`GET /user/trunk` と食い違わせない）
        const { placeOk: _o, ...rest } = outcome.label;
        void _o;
        outcome = { ...outcome, label: rest };
    }
    return outcome;
}

/** 確かめを、待ちの切れ目までだけ待つ。切れた・落ちたら true（＝答えはそのまま。確かめは裏で続く・落ちたら記録だけ） */
async function confirmWithin(uid: string, photoId: string, deadline?: number): Promise<boolean> {
    const confirm = confirmPlaceOk(uid, photoId, labelMatcher(photoId, "")).catch((e) => {
        console.error(`trunk: 付けた印の確かめに失敗しました（${uid}・${photoId}）:`, e);
        return true;
    });
    if (deadline === undefined) return confirm;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            confirm,
            new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), Math.max(0, deadline - Date.now())); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** 外側の待ち（`TRUNK_QUIET_LIMIT_MS`）より少し前に、確かめを待つのをやめる（配りの答えを時間切れにしない） */
const CONFIRM_MARGIN_MS = 200;

/**
 * **「地名を見せてよい」印の決まり（1か所）**（2026-10-18 判断）:
 *
 * - **付ける**のは、その写真そのもので確かめたときだけ（`placeOkFor`）。束の兄弟を根拠に付けない
 * - **残す**のは、その写真か、**強い読みで読んだ**束の兄弟のどれかが、誰にでも見える公開で撮影地が同じとき
 *   （取り消し・付け直し・本人の GET の外しが同じ決まり。`siblingPlaces` は強い読みの兄弟の撮影地）
 * - 付けたあとの確かめ（`confirmPlaceOk`）は、付けた根拠（その写真）だけをもう一度見る
 */
export function placeOkNext(
    l: TrunkLabel, self: Record<string, unknown> | undefined, uid: string, siblingPlaces: Set<string>,
): boolean {
    if (placeOkFor(l.place, self, uid)) return true;
    return !!l.placeOk && siblingPlaces.has(placeKey(l.place));
}

/** そのラベル（手持ち・貼った方）に「地名を見せてよい」印があるか */
function hasPlaceOk(doc: TrunkDoc, id: string): boolean {
    return !!(doc.pocket.find((l) => l.id === id) ?? doc.stuck.find((l) => l.id === id))?.placeOk;
}

/**
 * 印を**付けた**あとに呼ぶ: 写真を強い読みで読み直し、もう見せてよくない（公開でない・無い・撮影地が違う）なら
 * 印を外す。**外すだけ**（付けはしない）。
 * 印は「その写真そのもの」でしか付かない（`placeOkNext`）ので、確かめも付けた根拠のその写真だけを見る
 * （束の兄弟は見ない＝読みを増やさない）
 */
export async function confirmPlaceOk(uid: string, photoId: string, match: (l: TrunkLabel) => boolean): Promise<boolean> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId }, ConsistentRead: true }));
    const row = res.Item as Record<string, unknown> | undefined;
    let removed = false;
    await updateTrunk(uid, (doc, exists) => {
        if (!exists) return null;
        const next = setPlaceOk(doc, match, (l) => !!l.placeOk && placeOkFor(l.place, row, uid));
        removed = !!next;
        return next;
    });
    return !removed;
}

/**
 * 写真の編集（`photoUpdate.ts`）で**下書き → 公開**になったときに呼ぶ。行を読み直して、
 * savePhoto と同じ判定（受け取り設定・指紋・束・1日の上限・手持ちの上限）で配る。
 * 編集で直した撮影地などが載るよう、更新を書いたあとの行を読む。投げない・上限つきで待つ
 */
export async function grantLabelForPhotoQuietly(uid: string, photoId: string, label: string): Promise<DealOutcome> {
    // 2026-10-17 判断: 呼ぶ側（`photoUpdate.ts`）が「初めての公開」（`firstPublishedAt` を条件つきで書けた）
    // ときだけ呼ぶ。ここでは機能を出した日より前に作られた写真を落とす
    const deadline = Date.now() + TRUNK_QUIET_LIMIT_MS - CONFIRM_MARGIN_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async (): Promise<DealOutcome> => {
                // **強い読み**（いま書いた公開の状態・撮影地を必ず見る）
                const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId }, ConsistentRead: true }));
                const row = res.Item as Photo | undefined;
                // 持ち主の行だけ（読み直すあいだに消えた・別の人の行は配らない）
                if (!row || (row.userId ?? row.uploadedBy) !== uid) return noDeal("draft");
                if (!createdAfterLaunch(row)) return noDeal("notNew");
                return grantLabel(uid, row, new Date(), cryptoRand, undefined, deadline);
            })().catch((e): DealOutcome => {
                console.error(`${label}: ラベルを配れませんでした（${uid}）:`, e);
                return noDeal("error");
            }),
            new Promise<DealOutcome>((resolve) => {
                timer = setTimeout(() => resolve(noDeal("timeout")), TRUNK_QUIET_LIMIT_MS);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** 機能を出した日より後に作られた写真か（作成の時刻が読めなければ、配らない側に倒す） */
export function createdAfterLaunch(p: { createdAt?: unknown }): boolean {
    const t = typeof p.createdAt === "string" ? Date.parse(p.createdAt) : NaN;
    return Number.isFinite(t) && t >= Date.parse(TRUNK_LAUNCHED_AT);
}

/**
 * savePhoto の成功のあとに呼ぶ。**投げない・上限つきで待つ**（`refreshBadgesQuietly` と同じ形）。
 * 上限を越えたら `timeout`。
 * ⚠️（推測・直していない）時間切れのあとも書き込みは走りうるので、応答は `timeout` なのにラベルは
 * 届いていることがある（`GET /user/trunk` に出る）。Lambda は応答を返すと止まるので、届かないこともある
 *
 * @param opts.photos 本人の写真の一覧（メダルの数え直しと1回の読みを分け合う）
 * @param opts.requireNew 再送の経路では、機能を出した日より前に作られた写真に配らない（古い下書きを
 *   再送の形で公開して集めさせない）
 */
export async function grantLabelQuietly(
    uid: string, photo: Photo, label: string, opts: { photos?: Promise<Photo[]>; requireNew?: boolean } = {},
): Promise<DealOutcome> {
    if (!uid || !isCountablePhoto(photo)) return noDeal("draft");
    if (opts.requireNew && !createdAfterLaunch(photo)) return noDeal("notNew");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            grantLabel(uid, photo, new Date(), cryptoRand, opts.photos, Date.now() + TRUNK_QUIET_LIMIT_MS - CONFIRM_MARGIN_MS,
                { resend: !!opts.requireNew }).catch((e): DealOutcome => {
                console.error(`${label}: ラベルを配れませんでした（${uid}）:`, e);
                return noDeal("error");
            }),
            new Promise<DealOutcome>((resolve) => {
                timer = setTimeout(() => resolve(noDeal("timeout")), TRUNK_QUIET_LIMIT_MS);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ─── はじめての硬貨（2026-10-18 owner 承認） ─────────────────────

/**
 * はじめての硬貨の対象か。
 * - `yes`     対象
 * - `no`      対象外と確かめた → 対象外の印を残す
 * - `unknown` 決められない（退会の墓石・プロフィールの行が無く `auth_time` も読めない）→ 配らない・印も残さない
 *            （印を残さないので、あとで決め直せば次に開いたときに配れる）
 */
export type WelcomeVerdict = "yes" | "no" | "unknown";

export type WelcomeResult = { granted: boolean; added: number; coins: number };

/** 対象かを決める手がかり（`welcomeCoins` が集める） */
export type WelcomeEvidence = {
    /** users テーブルの本人の行（無ければ undefined） */
    profile: Record<string, unknown> | undefined;
    /**
     * JWT の `auth_time`（**いまのログインを始めた時刻**・ミリ秒）。更新トークンでの取り直しでは同じ値のまま、
     * ログインし直すと新しくなる。無い・読めなければ undefined
     */
    authTimeMs?: number;
    /** 機能より前に作った本人の写真・ストーリーがあるか（引かなかったら undefined） */
    hasOldItems?: boolean;
};

/**
 * 対象かを決める（純関数）。2026-10-18 判断（coordinator）の順:
 *
 *     1. users の行の `createdAt` が線より前                → 対象
 *     2. 行はあるが `createdAt` が無い（読めない値も同じ）     → 対象
 *        （`createdAt` を書くトリガーは 2026-08-19 から。それより前の古い利用者の行）
 *     3. JWT の `auth_time` が線より前                       → 対象
 *        （`auth_time` は**いまのログインを始めた時刻**。更新トークンでの取り直しでは変わらず、ログインし直すと
 *         新しくなる。前から居るのに users の行がまだ無く、アプリを開いた瞬間に `createProfileIfMissing` が
 *         今の時刻で行を作った人を拾う。**拾えるのは「行の無い古い人で、線のあとにログインし直していない人」だけ**）
 *     4. 機能より前の写真・ストーリー（`userId-createdAt-index`）がある → 対象
 *     5. どれも無い → 対象外（印を残す）。ただし**行が無く `auth_time` も無い・読めない**人は
 *        決められない（印を残さない）
 *
 * 登録の時刻は users の行の `createdAt`（作るのは登録完了のトリガー `api/src/cognitoTrigger.ts`・
 * 行が無い人がプロフィールを開いたとき `userProfile.ts` の `createProfileIfMissing`・行の無い人の Pro の購入
 * `supporterStore.ts`。どれも作ったその時刻）。Cognito の `UserCreateDate` は `AdminGetUser` の権限
 * （IAM の変更）が要り、JWT にも載らないので使わない。退会の墓石は配らない
 */
export function welcomeVerdictOf(ev: WelcomeEvidence): WelcomeVerdict {
    const { profile } = ev;
    if (isDeletedProfile(profile)) return "unknown";
    const line = Date.parse(TRUNK_COINS_LAUNCHED_AT);
    const t = typeof profile?.createdAt === "string" ? Date.parse(profile.createdAt) : NaN;
    if (Number.isFinite(t) && t < line) return "yes";
    if (profile && !Number.isFinite(t)) return "yes";
    if (ev.authTimeMs !== undefined && ev.authTimeMs < line) return "yes";
    if (ev.hasOldItems) return "yes";
    if (!profile && ev.authTimeMs === undefined) return "unknown";
    return "no";
}

/** 1〜4 の手前で決まるか（決まれば索引を引かない） */
const decidedWithoutItems = (ev: WelcomeEvidence) => {
    const v = welcomeVerdictOf({ ...ev, hasOldItems: false });
    return v === "yes" || isDeletedProfile(ev.profile);
};

/**
 * JWT の `auth_time`（秒）をミリ秒に。API Gateway（HTTP API）の JWT の確かめ役は、数の項目も
 * **文字に直して** claims に入れるので、数でも文字でも読む。読めなければ undefined
 */
export function authTimeMsOf(v: unknown): number | undefined {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,12}$/.test(v.trim()) ? Number(v.trim()) : NaN;
    return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
}

/**
 * はじめての硬貨を配る（純関数）。**変えないときは doc: null**。
 * - 配った・対象外の印があれば何もしない（二度配らない）
 * - 対象外（`no`）→ 対象外の印だけ残す。決められない（`unknown`）→ 何も書かない
 * - 対象（`yes`）→ 10 枚。上限 99 を超える分は配らない（足せた枚数を返す）。足せたのが 0 枚でも印は残す
 *   （2026-10-18 判断: 一度きりの配りは「その時に足せた分」。あとで空きができても配り直さない）
 * `granted` はこの呼び出しで1枚以上配ったときだけ true
 */
export function welcomeInto(doc: TrunkDoc, verdict: WelcomeVerdict, now: Date): { doc: TrunkDoc | null; result: WelcomeResult } {
    const none = { granted: false, added: 0, coins: doc.coins };
    if (doc.welcomeCoinsAt || doc.welcomeCheckedAt) return { doc: null, result: none };
    if (verdict === "unknown") return { doc: null, result: none };
    const at = now.toISOString();
    if (verdict === "no") return { doc: { ...doc, welcomeCheckedAt: at }, result: none };
    const added = Math.max(0, Math.min(WELCOME_COINS, COINS_MAX - doc.coins));
    const coins = doc.coins + added;
    return {
        doc: { ...doc, coins, welcomeCoinsAt: at, welcomeCoinsAdded: added },
        result: { granted: added > 0, added, coins },
    };
}

/** 本人の、機能より前に作られた行（写真・ストーリー）が1つでもあるか（索引を1件だけ引く） */
async function hasItemsBeforeCoins(uid: string): Promise<boolean> {
    const res = await ddb.send(new QueryCommand({
        TableName: PHOTOS_TABLE,
        IndexName: USER_INDEX,
        KeyConditionExpression: "userId = :u AND createdAt < :t",
        ExpressionAttributeValues: { ":u": uid, ":t": TRUNK_COINS_LAUNCHED_AT },
        ProjectionExpression: "id",
        Limit: 1,
    }));
    return (res.Items?.length ?? 0) > 0;
}

/**
 * `POST /user/trunk/welcome`（アプリを開いたときに呼ぶ）。
 * 2回目からは**トランクの2行を読むだけ**（印があれば users テーブルも索引も読まない）。
 * 並んだ2本・再送でも、rev 条件の書き込み（`updateTrunk`）が印を見て1回だけにする
 */
export async function welcomeCoins(uid: string, now: Date = new Date(), authTime?: unknown): Promise<WelcomeResult> {
    const rows = await readTrunkRows(uid);
    const first = parseTrunk(rows.main, rows.ledger);
    if (first.welcomeCoinsAt || first.welcomeCheckedAt) return { granted: false, added: 0, coins: first.coins };
    const profile = (await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: uid },
        ProjectionExpression: "userId, createdAt, deletedAt",
    }))).Item as Record<string, unknown> | undefined;
    if (isDeletedProfile(profile)) return { granted: false, added: 0, coins: first.coins };
    const ev: WelcomeEvidence = { profile, authTimeMs: authTimeMsOf(authTime) };
    const verdict = welcomeVerdictOf(decidedWithoutItems(ev) ? ev : { ...ev, hasOldItems: await hasItemsBeforeCoins(uid) });
    let result: WelcomeResult = { granted: false, added: 0, coins: first.coins };
    await updateTrunk(uid, (doc) => {
        const r = welcomeInto(doc, verdict, now);
        result = r.result;
        if (r.doc && !fitsBudget(r.doc)) throw new TrunkError(409, "トランクの容量がいっぱいです", "storage");
        return r.doc;
    });
    return result;
}

// ─── アイコン・カバーのお礼（#304） ───────────────────────────

export type RewardKind = ProfileImageKind;
export const isRewardKind = (v: unknown): v is RewardKind => v === "avatar" || v === "cover";

const rewardAtKey = (kind: RewardKind): "rewardAvatarAt" | "rewardCoverAt" =>
    (kind === "avatar" ? "rewardAvatarAt" : "rewardCoverAt");
const rewardAddedKey = (kind: RewardKind): "rewardAvatarAdded" | "rewardCoverAdded" =>
    (kind === "avatar" ? "rewardAvatarAdded" : "rewardCoverAdded");

/**
 * お礼を配る（純関数）。**変えないときは doc: null**。
 * - 印があれば何もしない（消して付け直しても二度目は無い）
 * - 設定されていない（`isSet` が false）→ 何も書かない（印も立てない。設定したあとの呼び出しで渡せる）
 * - 設定されている → 3 枚。上限 99 を超える分は配らない。**0 枚しか足せなくても印は立てる**
 *   （はじめての硬貨と同じ決まり・`welcomeInto`）
 * `granted` はこの呼び出しで1枚以上配ったときだけ true。
 * `rewarded` は**この種類のお礼の印が立っているか**（前から・この呼び出しで、のどちらでも true）。
 * アプリは false の間は起動のときに確かめ直し、差し出しの「硬貨 3 枚」の行もこれで出し分ける（2026-10-18 見直し）
 */
export type RewardResult = WelcomeResult & { rewarded: boolean };

export function rewardInto(doc: TrunkDoc, kind: RewardKind, isSet: boolean, now: Date): { doc: TrunkDoc | null; result: RewardResult } {
    if (doc[rewardAtKey(kind)]) return { doc: null, result: { granted: false, added: 0, coins: doc.coins, rewarded: true } };
    if (!isSet) return { doc: null, result: { granted: false, added: 0, coins: doc.coins, rewarded: false } };
    const added = Math.max(0, Math.min(REWARD_COINS, COINS_MAX - doc.coins));
    const coins = doc.coins + added;
    return {
        doc: { ...doc, coins, [rewardAtKey(kind)]: now.toISOString(), [rewardAddedKey(kind)]: added },
        result: { granted: added > 0, added, coins, rewarded: true },
    };
}

/**
 * `POST /user/trunk/reward { kind }`（#304・2026-10-18 トランク担当と決めた形）。
 * アプリはアイコン・カバーを保存したあとと、起動のとき（すでに設定済みの人に1回・はじめての硬貨と同じ呼び方）に呼ぶ。
 *
 * 1. トランクの2行を読む。印があればそれだけで返す（2回目からは users も S3 も読まない）
 * 2. users の行を**強い読み**で読む。退会の墓石なら配らない
 * 3. 実際に設定されているかを確かめる。**アイコン・カバーは users に項目が無い**（置き場は S3 の決まったキーだけ・
 *    `profile.ts`）ので、その実体を公開の CDN に HEAD で聞く（`profileImage.ts`。共有のロールに profiles/* の読みを足さない）
 * 4. 印は `updateTrunk`（rev 条件）の中で立てる。並んだ2本・再送でも1回だけ。trunk# の行が無ければ作る
 *
 * ⚠️ CDN は無いキーの 404 を約10秒覚え、問い（`?r=`）は既定のキャッシュポリシーでは鍵に入らない見込み
 * （`scripts/verify-origin-failover.js`）。置いた直後は「無い」と答えることがあるので、アプリと Web は
 * `added == 0` かつ `rewarded == false` なら約12秒おいて1回だけ頼み直す
 */
export async function rewardCoins(uid: string, kind: RewardKind, now: Date = new Date()): Promise<RewardResult> {
    const rows = await readTrunkRows(uid);
    const first = parseTrunk(rows.main, rows.ledger);
    const none: RewardResult = { granted: false, added: 0, coins: first.coins, rewarded: false };
    if (first[rewardAtKey(kind)]) return { ...none, rewarded: true };
    const profile = (await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: uid },
        ProjectionExpression: "userId, deletedAt",
        ConsistentRead: true,
    }))).Item as Record<string, unknown> | undefined;
    if (isDeletedProfile(profile)) return none;
    const isSet = await profileImageExists(uid, kind);
    if (!isSet) return none;
    let result: RewardResult = none;
    await updateTrunk(uid, (doc) => {
        const r = rewardInto(doc, kind, isSet, now);
        result = r.result;
        if (r.doc && !fitsBudget(r.doc)) throw new TrunkError(409, "トランクの容量がいっぱいです", "storage");
        return r.doc;
    });
    return result;
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
        coins: doc.coins,
        parts: doc.parts,
        fragments: doc.fragments,
        equipped: viewEquipped(doc.equipped),
        showTrunk: doc.showTrunk,
        ticket: doc.ticket ?? null,
    };
}

/** 応答の形は場所を全部並べる（付けていない場所は null・ピンとワッペンは空の並び） */
function viewEquipped(e: Equipped) {
    const out: Record<string, string | null | string[]> = {};
    for (const slot of SINGLE_SLOTS) out[slot] = e[slot] ?? null;
    out.pins = e.pins;
    out.patches = e.patches;
    return out;
}

export type PublicLabel = Omit<TrunkLabel, "groupId">;

/** 束の印は配るときの見分けだけに使う（応答には出さない） */
export function stripInternal(l: TrunkLabel): PublicLabel {
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
    await updateTrunk(uid, (doc) => {
        const next = fn(doc, { pro, now });
        last = next ?? doc;
        if (next && !fitsBudget(next)) throw new TrunkError(409, "トランクの容量がいっぱいです", "storage");
        return next;
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

/**
 * 手持ちから貼る。貼った方に在れば何もしない（再送で 404 にしない）。
 * `pos` があればその置き場に、無ければ置き場なし（アプリがおまかせで置く）
 */
export const stickMutation = (id: string, pos?: TrunkPos): Mutation => (doc) => {
    if (doc.stuck.some((l) => l.id === id)) return null;
    const label = doc.pocket.find((l) => l.id === id);
    if (!label) throw new TrunkError(404, "ラベルが見つかりません", "notFound");
    if (doc.stuck.length >= STUCK_MAX) throw new TrunkError(409, "トランクがいっぱいです", "full");
    return {
        ...doc,
        pocket: doc.pocket.filter((l) => l.id !== id),
        stuck: [pos ? { ...label, pos } : label, ...doc.stuck],
        // 選びかけの作り直しは手持ちのラベルだけのもの。貼ったら捨てる（使った回数は戻らない）
        ...(doc.pendingReroll?.labelId === id ? { pendingReroll: undefined } : {}),
    };
};

/**
 * 貼ったラベルを置き直す（一括のおまかせ並べは、アプリがこれを順に呼ぶ）。
 * 手持ちのラベルは 409 `notStuck`（先に貼る）・どこにも無ければ 404
 */
export const placeMutation = (id: string, pos: TrunkPos | undefined): Mutation => (doc) => {
    if (!pos) throw new TrunkError(400, "置き場が正しくありません", "badPlace");
    const label = doc.stuck.find((l) => l.id === id);
    if (!label) {
        if (doc.pocket.some((l) => l.id === id)) throw new TrunkError(409, "まだ貼っていないラベルです", "notStuck");
        throw new TrunkError(404, "ラベルが見つかりません", "notFound");
    }
    const cur = label.pos;
    if (cur && cur.x === pos.x && cur.y === pos.y && cur.rot === pos.rot) return null;
    return { ...doc, stuck: doc.stuck.map((l) => (l.id === id ? { ...l, pos } : l)) };
};

/**
 * はがして手持ちに戻す（手持ちのいちばん上・置き場は消す）。手持ちが上限なら 409 `full`。
 * 手持ちに在れば何もしない（再送で 404 にしない）。24時間の取り消し・指紋の台帳は変えない
 */
export const unstickMutation = (id: string): Mutation => (doc, { pro }) => {
    if (doc.pocket.some((l) => l.id === id)) return null;
    const label = doc.stuck.find((l) => l.id === id);
    if (!label) throw new TrunkError(404, "ラベルが見つかりません", "notFound");
    if (doc.pocket.length >= pocketLimit(pro)) throw new TrunkError(409, "手持ちがいっぱいです", "full");
    const { pos: _p, ...rest } = label;
    void _p;
    return { ...doc, stuck: doc.stuck.filter((l) => l.id !== id), pocket: [rest, ...doc.pocket] };
};

/** ガチャの乱数（書く前に引く。競合で読み直しても同じ1回にする） */
export type GachaRoll = { tier: number; pick: number };

export function rollGacha(rand: Rand = cryptoRand): GachaRoll {
    const tier = rarityOfRoll(rand(0, 100));
    return { tier, pick: rand(0, PARTS_BY_RARITY[tier].length) };
}

export type GachaResult = { part: TrunkPart; duplicate: boolean; fragments: number; coins: number };

/**
 * 硬貨を1枚使って部品を1つ引く。持っていない部品なら部品箱へ、持っていれば「かけら」+1。
 * 硬貨が 0 なら 409 `noCoins`。結果は `out` に書く（最後に通った1回のもの）
 */
export const gachaMutation = (roll: GachaRoll, out: { result?: GachaResult }): Mutation => (doc) => {
    if (doc.coins < 1) throw new TrunkError(409, "硬貨がありません", "noCoins");
    const part = PARTS_BY_RARITY[roll.tier][roll.pick];
    const duplicate = doc.parts.includes(part.id);
    const next: TrunkDoc = {
        ...doc,
        coins: doc.coins - 1,
        ...(duplicate ? { fragments: doc.fragments + 1 } : { parts: [part.id, ...doc.parts] }),
    };
    out.result = { part, duplicate, fragments: next.fragments, coins: next.coins };
    return next;
};

/** かけら5つで、持っていない部品1つと交換。持っていれば 409 `owned`・足りなければ 409 `notEnoughFragments` */
export const exchangeMutation = (partId: unknown): Mutation => (doc) => {
    const part = partOf(partId);
    if (!part) throw new TrunkError(400, "部品が正しくありません", "badPart");
    if (doc.parts.includes(part.id)) throw new TrunkError(409, "もう持っている部品です", "owned");
    if (doc.fragments < FRAGMENTS_PER_EXCHANGE) throw new TrunkError(409, "かけらが足りません", "notEnoughFragments");
    return { ...doc, parts: [part.id, ...doc.parts], fragments: doc.fragments - FRAGMENTS_PER_EXCHANGE };
};

/**
 * 部品を付ける。本文に在る場所だけ変える（無い場所はそのまま）。null で外す。
 * - 知らない id は 400 `badPart`・場所と kind が合わなければ 400 `badKind`・持っていなければ 409 `notOwned`
 * - pins は3つまで・patches は2つまで（並びで渡す・同じ id を二度は 400）
 * 型（model）とは別に持つ。Pro 限定の部品は無い
 */
export const equipMutation = (b: Record<string, unknown>): Mutation => (doc) => {
    const owned = new Set(doc.parts);
    const check = (id: unknown, kind: PartKind): string => {
        const part = partOf(id);
        if (!part) throw new TrunkError(400, "部品が正しくありません", "badPart");
        if (part.kind !== kind) throw new TrunkError(400, "付ける場所が違います", "badKind");
        if (!owned.has(part.id)) throw new TrunkError(409, "持っていない部品です", "notOwned");
        return part.id;
    };
    const list = (v: unknown, kind: PartKind, max: number): string[] => {
        if (v === null) return [];
        if (!Array.isArray(v) || v.length > max) throw new TrunkError(400, "付けられる数を越えています", "badRequest");
        const ids = v.map((id) => check(id, kind));
        if (new Set(ids).size !== ids.length) throw new TrunkError(400, "同じ部品は二度付けられません", "badRequest");
        return ids;
    };
    const next: Equipped = { ...doc.equipped, pins: [...doc.equipped.pins], patches: [...doc.equipped.patches] };
    for (const slot of SINGLE_SLOTS) {
        if (!(slot in b)) continue;
        if (b[slot] === null) delete next[slot];
        else next[slot] = check(b[slot], slot);
    }
    if ("pins" in b) next.pins = list(b.pins, "pin", PINS_MAX);
    if ("patches" in b) next.patches = list(b.patches, "patch", PATCHES_MAX);
    if (JSON.stringify(compactEquipped(next)) === JSON.stringify(compactEquipped(doc.equipped))) return null;
    return { ...doc, equipped: next };
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
 * 設定。本文に在る項目だけ変える（1つも無ければ 400 `badRequest`）:
 *
 * - `receiveLabels`（真偽）: 受け取る／受け取らない。2026-10-17 owner: 止めていた間のぶんは、戻してもさかのぼって
 *   配らない（配るのは savePhoto のその場だけなので、止めていた間の投稿はそもそも数えていない）
 * - `showTrunk`（真偽・2026-10-18）: ほかの人にトランクを見せるか。false の間は `GET /users/{uid}/trunk` が 404
 * - `ticket`（`{ photoId, note?, origin?, destination?, face?, showsFrom? }` か `null`・2026-10-18）: わたしの乗車券。
 *   `null` で外す。写真が本人の公開写真かは口で先に確かめる（`ticketOk`）
 */
export const settingsMutation = (b: Record<string, unknown>, ticketOk = true): Mutation => (doc) => {
    const keys = ["receiveLabels", "showTrunk", "ticket"].filter((k) => k in b);
    if (keys.length === 0) throw new TrunkError(400, "設定が正しくありません", "badRequest");
    const next: TrunkDoc = { ...doc };
    if ("receiveLabels" in b) {
        if (typeof b.receiveLabels !== "boolean") throw new TrunkError(400, "設定が正しくありません", "badRequest");
        next.receiveLabels = b.receiveLabels;
    }
    if ("showTrunk" in b) {
        if (typeof b.showTrunk !== "boolean") throw new TrunkError(400, "設定が正しくありません", "badRequest");
        next.showTrunk = b.showTrunk;
    }
    if ("ticket" in b) {
        const ticket = parseTicket(b.ticket);
        if (ticket && !ticketOk) throw new TrunkError(409, "公開している自分の写真を選んでください", "ticketNotPublic");
        if (ticket) next.ticket = ticket;
        else delete next.ticket;
    }
    const same = next.receiveLabels === doc.receiveLabels && next.showTrunk === doc.showTrunk
        && JSON.stringify(next.ticket ?? null) === JSON.stringify(doc.ticket ?? null);
    return same ? null : next;
};

/**
 * 写真を消した・非公開にしたときの取り消し（純関数）。**投稿から24時間以内**なら、手持ちでも
 * **貼ったものでも**外す（2026-10-17 owner: 貼ってから消す、で取り消しを逃れさせない）。
 * 指紋の台帳・束の台帳・日の枚数・節目の記録はそのまま（上げ直しても届かない・日の枠も戻らない）。
 *
 * - 束の写真は、**束の写真がもう1枚も公開で残っていない**とき（`groupRemains: false`）だけ取り消す。
 *   ラベルは束の最初の1枚の id を持つので、束の鍵で探す。時刻はラベルの `at`
 * - 束でない写真は写真の id で探す。時刻は写真の初めての公開（`firstPublishedAt`）→ 作成（`createdAt`）→ ラベルの `at`
 * - **硬貨**も同じ時刻の線で取り消す（`coinLog` に控えのある投稿だけ）。まだ持っていれば1枚減らし、
 *   0 枚（もう使った）なら何もしない。控えはどちらでも消す。2026-10-17 判断: 硬貨は見分けが付かないので
 *   「その投稿の硬貨を使ったか」は数で見る（1枚でも持っていれば、それを戻す）
 */
export function revokeFrom(
    doc: TrunkDoc,
    target: { photoId: string; group?: string; groupRemains?: boolean; postedAt?: unknown },
    now: Date,
): TrunkDoc | null {
    if (target.group && target.groupRemains) return null;
    const match = (l: TrunkLabel) => (target.group ? l.groupId === target.group : l.id === target.photoId);
    const label = doc.pocket.find(match) ?? doc.stuck.find(match);
    const coinKey = target.group ?? target.photoId;
    const coinEntry = doc.coinLog.find((e) => e.k === coinKey);
    const p = target.postedAt;
    const postedAt = !target.group && typeof p === "string" && Number.isFinite(Date.parse(p)) ? Date.parse(p) : NaN;
    const within = (fallback: number) => {
        const posted = Number.isFinite(postedAt) ? postedAt : fallback;
        return Number.isFinite(posted) && now.getTime() - posted <= REVOKE_WINDOW_MS;
    };
    const dropLabel = !!label && within(Date.parse(label.at));
    const dropCoin = !!coinEntry && within(coinEntry.a * 1000);
    if (!dropLabel && !dropCoin) return null;
    return {
        ...doc,
        ...(dropLabel && label ? {
            pocket: doc.pocket.filter((l) => l.id !== label.id),
            stuck: doc.stuck.filter((l) => l.id !== label.id),
            ...(doc.pendingReroll?.labelId === label.id ? { pendingReroll: undefined } : {}),
        } : {}),
        ...(dropCoin ? {
            coins: Math.max(0, doc.coins - 1),
            coinLog: doc.coinLog.filter((e) => e !== coinEntry),
        } : {}),
    };
}

/**
 * 当たるラベル（手持ち・貼った方）の「地名を見せてよい」印を、`ok(ラベル)` のとおりに付ける／外す（純関数）。
 * 変わらなければ null
 */
export function setPlaceOk(doc: TrunkDoc, match: (l: TrunkLabel) => boolean, ok: (l: TrunkLabel) => boolean): TrunkDoc | null {
    let changed = false;
    const fix = (l: TrunkLabel): TrunkLabel => {
        if (!match(l)) return l;
        const want = ok(l);
        if (!!l.placeOk === want) return l;
        changed = true;
        if (want) return { ...l, placeOk: true };
        const { placeOk: _o, ...rest } = l;
        void _o;
        return rest;
    };
    const next = { ...doc, pocket: doc.pocket.map(fix), stuck: doc.stuck.map(fix) };
    return changed ? next : null;
}

/** 写真から、当たるラベルの見分け方（束なら束の鍵・そうでなければ写真の id） */
function labelMatcher(photoId: string, group: string): (l: TrunkLabel) => boolean {
    const g = group ? groupKey(group) : "";
    return (l) => (g ? l.groupId === g : l.id === photoId);
}

/**
 * 束の写真が、この1枚のほかに**まだ公開で残っているか**。
 *
 * 兄弟の id は索引（`listMyPhotos`・結果整合）から引き、**1枚ずつ強い読みで確かめる**
 * （索引には、消した・非公開にしたばかりの写真が古い姿で残りうる）。
 * ⚠️ 索引にまだ載っていない兄弟（いま上げたばかりの写真）は見落としうる——そのときは
 * 「残っていない」と読んで取り消す側に倒れる。束の id を全部持つ場所は無い（行は1枚ずつ）
 */
async function groupSiblings(uid: string, group: string, exceptId: string): Promise<{
    /** 束の写真がまだ公開で残っているか（取り消しの線・下書きでない・ストーリーでない） */
    remains: boolean;
    /** 誰にでも見える公開で残っている兄弟の撮影地（`placeKey`）。地名を見せてよいかの根拠 */
    publicPlaces: Set<string>;
}> {
    const ids = (await listMyPhotos(uid))
        .filter((o) => o.id !== exceptId && typeof o.groupId === "string" && o.groupId.trim() === group)
        .map((o) => o.id);
    let remains = false;
    const publicPlaces = new Set<string>();
    for (const id of ids) {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id }, ConsistentRead: true }));
        const row = res.Item as Record<string, unknown> | undefined;
        if (!row || (row.userId ?? row.uploadedBy) !== uid) continue;
        if (isCountablePhoto(row as unknown as Photo)) remains = true;
        // 2026-10-18: 絞った写真（closeFriends・フォロワー限定）は「公開で残っている」に数えない
        if (isPublicListPhoto(row)) publicPlaces.add(placeKey(placeOf(row as unknown as Photo)));
    }
    return { remains, publicPlaces };
}

/**
 * 束の兄弟を**強い読みで並べて**読み、誰にでも見える公開の兄弟の撮影地を返す（`listed` は本人の写真の一覧・索引）。
 * 読むのは `STALE_READ_MAX` 枚まで（それより大きい束は、読めた兄弟に根拠が無ければ外す側に倒れる）。
 * 読みが落ちた兄弟は根拠にしない
 */
async function strongSiblingPlaces(uid: string, group: string, exceptId: string, listed: Photo[]): Promise<Set<string>> {
    const ids = listed.filter((o) => o.id !== exceptId && typeof o.groupId === "string" && o.groupId.trim() === group)
        .map((o) => o.id).slice(0, STALE_READ_MAX);
    const out = new Set<string>();
    await Promise.all(ids.map(async (id) => {
        try {
            const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id }, ConsistentRead: true }));
            const row = res.Item as Record<string, unknown> | undefined;
            if (row && (row.userId ?? row.uploadedBy) === uid && isPublicListPhoto(row)) out.add(placeKey(placeOf(row as unknown as Photo)));
        } catch (e) {
            console.error(`trunk: 束の兄弟の読みに失敗しました（${uid}・${id}）:`, e);
        }
    }));
    return out;
}

/**
 * 写真の削除（`deleteMyPhoto`）と、公開 → 非公開（`updatePhotoVisibility`）のあとに呼ぶ。
 * **投げない・上限つきで待つ**。落ちても削除・非公開は成功のまま（ラベルが残るだけ）。
 * `photo` は**消す・隠す前の行**。退会は行ごと消す（`account.ts`）ので、ここは通らない
 */
export async function revokeLabelQuietly(uid: string, photo: Record<string, unknown>, label: string): Promise<void> {
    const photoId = typeof photo.id === "string" ? photo.id : "";
    if (!uid || !photoId) return;
    const g = typeof photo.groupId === "string" ? photo.groupId.trim() : "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            (async () => {
                const sib = g ? await groupSiblings(uid, g, photoId) : { remains: false, publicPlaces: new Set<string>() };
                await updateTrunk(uid, (doc, exists) => {
                    if (!exists) return null;
                    const revoked = revokeFrom(doc, {
                        photoId,
                        ...(g ? { group: groupKey(g), groupRemains: sib.remains } : {}),
                        postedAt: photo.firstPublishedAt ?? photo.createdAt,
                    }, new Date());
                    // 取り消されずに残ったラベルは、地名を見せてよい印を外す（同じ書き込みに相乗り）。
                    // 束は、誰にでも見える公開の兄弟が同じ撮影地で残っているときだけ印を残す
                    const base = revoked ?? doc;
                    // 写真そのものは消えた・隠れた（self なし）。残すのは強い読みの兄弟が根拠になるときだけ（`placeOkNext`）
                    const fixed = setPlaceOk(base, labelMatcher(photoId, g), (l) => placeOkNext(l, undefined, uid, sib.publicPlaces));
                    return fixed ?? revoked;
                });
            })().catch((e) => {
                console.error(`${label}: ラベルを取り消せませんでした（${uid}）:`, e);
            }),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, TRUNK_QUIET_LIMIT_MS); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 写真の編集（`photoUpdate.ts` の `updatePhotoVisibility`）のあとに呼ぶ。公開範囲・公開の切り替え・撮影地が
 * 変わったら、その写真から来たラベルの「地名を見せてよい」印を付け直す（絞った・撮影地を変えた → 外す、
 * 全員に戻した・撮影地を戻した → 付ける）。
 *
 * `before` は**編集する前の行**。今の行は強い読みで1回読む。公開の一覧に載るかも撮影地も変わっていなければ
 * trunk を読まない。束の写真は、誰にでも見える公開の兄弟が同じ撮影地で残っていれば印を残す。
 * 投げない・上限つきで待つ
 */
export async function refreshLabelPlaceQuietly(
    uid: string, photoId: string, before: Record<string, unknown>, label: string,
): Promise<void> {
    if (!uid || !photoId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            (async () => {
                const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId }, ConsistentRead: true }));
                const after = res.Item as Record<string, unknown> | undefined;
                if (!placeOkMayChange(before, after)) return;
                const row = after ?? before;
                const g = typeof row.groupId === "string" ? row.groupId.trim() : "";
                const sib = g ? await groupSiblings(uid, g, photoId) : { remains: false, publicPlaces: new Set<string>() };
                const match = labelMatcher(photoId, g);
                let added = false;
                await updateTrunk(uid, (doc, exists) => {
                    if (!exists) return null;
                    // 付けるのはこの写真で確かめたときだけ・兄弟は残す根拠にだけなる（`placeOkNext`）
                    const next = setPlaceOk(doc, match, (l) => placeOkNext(l, after, uid, sib.publicPlaces));
                    added = !!next && [...next.pocket, ...next.stuck].some((l) => match(l) && l.placeOk
                        && !([...doc.pocket, ...doc.stuck].find((d) => d.id === l.id)?.placeOk));
                    return next;
                });
                // 付けた回だけ、書いたあとに写真を読み直して確かめる（この読みと書きのあいだに絞る編集が終わっていた・凍結で遅れた）。
                // 束の兄弟は根拠にしない（`confirmPlaceOk`）。確かめが落ちても記録だけ
                if (added) await confirmPlaceOk(uid, photoId, match).catch((e) => {
                    console.error(`${label}: 付けた印の確かめに失敗しました（${uid}）:`, e);
                });
            })().catch((e) => {
                console.error(`${label}: ラベルの地名の印を付け直せませんでした（${uid}）:`, e);
            }),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, TRUNK_QUIET_LIMIT_MS); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ─── 人のトランク（2026-10-18 owner「他の人のトランクの中身とか見れたら楽しい」）──────────

/**
 * 人の口に出すラベル。**写真の id は出さない**（ラベルの id は写真の id。非公開にした・消した写真の id を
 * 人に渡さない——公開プロフィールのピン（`publicPinnedIds`）と同じ構え）。
 *
 * - `id`: **この返答の中の番号**（`s` ＋ 貼った古い順の番号 0, 1, 2…）。写真の id からは計算できない。
 *   画面がラベルを並べ・選ぶための見分けだけに使う（2026-10-18 判断: iOS の人のトランクの画面は1回の返答の中で
 *   ラベルを選んで写真を出すだけで、返答をまたいで同じラベルを指す使い道が無い。古い順に数えるので、新しく貼られても
 *   前の番号は変わらない。はがす・取り消すと、それより新しい番号はずれる）。新しい秘密の設定・行の項目は増やさない
 * - **地名を見せてよいと確かめたラベル**（`placeOk`）で地名があるもの: `place`・`season`・`timeslot`・`milestone`・
 *   `at`（日付だけ `YYYY-MM-DD`）・`where`（その土地で撮った写真を引く手がかり。`GET /photos?userId=<uid>` の結果のうち、
 *   `location` を `,、，/()（）` で割った先頭が `where.location` と同じ写真・無ければ `location` に含む写真）
 * - **それ以外**（確かめていない・地名がもともと空）: `{ id, kind, seed, foil?, pos?, place: { name: "" }, where: null }` だけ。
 *   日付・季節・時刻・節目も落とす——伏せたラベルから「いつ投稿した写真が今は見えないか」が分からないように、
 *   **2つは同じ形にして見分けられないようにする**（iOS は「地名が空なら地名なしの形で描く」）
 *
 * 2026-10-18 判断: 写真の一覧はサーバーで絞らない（人の写真を全部読むことになる・公開写真の口がもう在る）
 */
export type TheirLabel = {
    id: string;
    kind: LabelKind;
    place: TrunkLabel["place"];
    season?: TrunkLabel["season"];
    timeslot?: TrunkLabel["timeslot"];
    milestone?: TrunkLabel["milestone"];
    seed: number;
    at?: string;
    foil?: true;
    pos?: TrunkPos;
    where: { location: string } | null;
};

/** `index` は貼った古い順の番号（`readTheirTrunk` が数える） */
export function theirLabel(index: number, l: TrunkLabel): TheirLabel {
    const base = {
        id: `s${index}`,
        kind: l.kind,
        seed: l.seed,
        ...(l.foil ? { foil: true as const } : {}),
        ...(l.pos ? { pos: l.pos } : {}),
    };
    // **確かめた物だけ見せる**: 印（`placeOk`）の無いラベルと、地名がもともと空のラベルは同じ形（地名・日付なし）
    if (!l.placeOk || !l.place.name) return { ...base, place: { name: "" }, where: null };
    return {
        ...base,
        place: l.place,
        ...(l.season ? { season: l.season } : {}),
        ...(l.timeslot ? { timeslot: l.timeslot } : {}),
        ...(l.milestone ? { milestone: l.milestone } : {}),
        at: l.at.slice(0, 10),
        where: { location: l.place.name },
    };
}

/** 人のトランクを見せない（区別しない 404 にする）とき */
class HiddenTrunk extends Error {}

/**
 * `GET /users/{uid}/trunk` の中身。**読みは GetItem だけ**（人のプロフィール・トランクの行・ブロックの印2つ・
 * 乗車券の写真1枚）。台帳の行（`trunkledger#`）と人の写真の一覧は読まない。
 *
 * 見せないとき（`HiddenTrunk` を投げる＝404・理由は区別しない）: 見せない設定（`showTrunk: false`）・
 * どちらかがブロックしている・退会した（プロフィールが無い・墓石）・トランクの行が無い。
 * **自分を読んだときは**この形をそのまま返す（見せない設定・ブロックは見ない＝人からの見え方を自分で確かめられる）
 *
 * 返す物（板 TheirTrunk・TheirInside・TrunkPrivacy）:
 *     model     見せている型（`effectiveModel`。Pro をやめた人の Pro の型は出さない）
 *     stuck     貼ったラベル（置き場つき・`theirLabel`）。手持ちのラベルは出さない
 *     equipped  付けた部品（部品箱・かけらは出さない）
 *     posts     古び方に使う公開の投稿の数（控えが無ければ項目ごと無い）
 *     inside    { badges: メダル（公開プロフィールと同じ `sanitizeBadges`）,
 *                 card: 会員証 { pro } | null（サポーター番号を持つ人だけ。番号・始めた年月・月数は出さない）,
 *                 ticket: わたしの乗車券 { photoId, note, origin, destination, face, showsFrom } | null }
 * 出さない物: 硬貨・手持ち・上限・作り直し・受け取りの設定・部品箱・かけら・受け取った乗車券（端末の中だけ）・
 * ラベルの写真の id
 */
export async function readTheirTrunk(viewer: string, target: string, now: Date = new Date()) {
    const self = viewer === target;
    const [profileRes, trunkRes, blocked] = await Promise.all([
        ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: target },
            ProjectionExpression: "userId, supporter, badges, deletedAt",
        })),
        ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: trunkId(target) } })),
        self ? Promise.resolve(false)
            : Promise.all([isBlocked(viewer, target), isBlocked(target, viewer)]).then(([a, b]) => a || b),
    ]);
    const profile = profileRes.Item as Record<string, unknown> | undefined;
    const row = trunkRes.Item as Record<string, unknown> | undefined;
    if (!profile || isDeletedProfile(profile) || !row || blocked) throw new HiddenTrunk();
    // 台帳は読まない（人に出す物は持ち物の行だけにある）。古い形の行でも持ち物は読める
    const doc = parseTrunk(row, {});
    if (!doc.showTrunk && !self) throw new HiddenTrunk();
    const pro = isPro(profile, now.getTime());
    let ticket: TrunkTicket | null = null;
    if (doc.ticket) {
        const res = await ddb.send(new GetCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: doc.ticket.photoId },
            ProjectionExpression: "id, userId, uploadedBy, src, published, story, audience",
        }));
        // 置いたあとで消した・非公開にした・公開範囲を絞った写真は出さない
        if (isOwnPublicPhoto(res.Item as Record<string, unknown> | undefined, target)) {
            ticket = { ...doc.ticket, face: pro ? doc.ticket.face : 0 };
        }
    }
    return {
        userId: target,
        model: effectiveModel(doc, pro),
        // 番号は古い順（`stuck` は新しい順なので後ろから数える）
        stuck: doc.stuck.map((l, i) => theirLabel(doc.stuck.length - 1 - i, l)),
        equipped: viewEquipped(doc.equipped),
        ...(doc.posts !== undefined ? { posts: doc.posts } : {}),
        inside: {
            badges: sanitizeBadges(profile.badges) ?? {},
            card: publicSupporter(profile, now.getTime()) ? { pro } : null,
            ticket,
        },
    };
}

/** 本人が開いたときに、古び方の控え（`posts`）を書き直す。行が無ければ作らない。落ちても GET は成功のまま */
async function noteTrunkQuietly(uid: string, posts: number, stale: Set<string>): Promise<void> {
    try {
        await updateTrunk(uid, (doc, exists) => {
            if (!exists) return null;
            const base = setPlaceOk(doc, (l) => stale.has(l.id), () => false) ?? doc;
            return base === doc && doc.posts === posts ? null : { ...base, posts };
        });
    } catch (e) {
        console.error(`trunk: 投稿の数の控え・地名の印を書けませんでした（${uid}）:`, e);
    }
}

/**
 * 本人の写真の一覧（`listMyPhotos`・**結果整合の索引**）と突き合わせて、**外し損ねたかもしれない**
 * 「地名を見せてよい」印のラベルを挙げる（純関数）。印つきなのに、一覧の上で公開でない・撮影地が違う・一覧に無い。
 * 返すのは「ラベル id → 強い読みで確かめる写真の id」。索引は下書き → 公開・closeFriends → 全員の直後に古い姿を
 * 返しうるので、**ここで挙がっただけでは外さない**（`confirmStale` が読み直してから外す）。ふだんは0件＝読みは増えない。
 * 束のラベルは、一覧の上で束の写真のどれかが誰にでも見える公開で同じ撮影地なら挙げない。**付ける側はやらない**
 */
export function stalePlaceOkCandidates(doc: TrunkDoc, photos: Record<string, unknown>[], uid: string): Map<string, string[]> {
    const byId = new Map(photos.map((p) => [String(p.id), p]));
    const byGroup = new Map<string, Record<string, unknown>[]>();
    for (const p of photos) {
        const g = typeof p.groupId === "string" ? p.groupId.trim() : "";
        if (!g) continue;
        const k = groupKey(g);
        byGroup.set(k, [...(byGroup.get(k) ?? []), p]);
    }
    const out = new Map<string, string[]>();
    for (const l of [...doc.pocket, ...doc.stuck]) {
        if (!l.placeOk) continue;
        const siblings = l.groupId ? byGroup.get(l.groupId) ?? [] : [];
        const candidates = [byId.get(l.id), ...siblings].filter((p): p is Record<string, unknown> => !!p);
        if (candidates.some((p) => placeOkFor(l.place, p, uid))) continue;
        out.set(l.id, [...new Set([l.id, ...siblings.map((p) => String(p.id))])]);
    }
    return out;
}

/** 1回の `GET /user/trunk` で、外しの確かめに読む写真の上限（超えた分は次の GET に回す） */
export const STALE_READ_MAX = 25;

/**
 * 挙がったラベルの写真を**強い読み**で（並べて）読み直し、本当に見せてよくないものだけ返す。残す決まりは
 * `placeOkNext`（その写真か、束の兄弟のどれかが誰にでも見える公開で撮影地が同じ）。
 * **外しは最善の努力**: 読みが落ちたラベルは外さない（記録だけ・画面は 500 にしない）。読む写真は1回の GET で
 * `STALE_READ_MAX` 枚まで（超えたラベルは今回は外さず、次の GET で見る）
 */
async function confirmStale(doc: TrunkDoc, candidates: Map<string, string[]>, uid: string): Promise<Set<string>> {
    const all = [...doc.pocket, ...doc.stuck];
    const picked: [TrunkLabel, string[]][] = [];
    let budget = STALE_READ_MAX;
    for (const [labelId, photoIds] of candidates) {
        const l = all.find((x) => x.id === labelId);
        if (!l || budget === 0) continue;
        // 上限より大きい束は、**枠が満タンの回だけ**、ラベルの写真＋兄弟を上限まで読む（いつも同じ 25 枚で判断する。
        // 残す根拠が見つからなければ外す側に倒す）。満タンでない回・上限に収まる束が今回の残りに入らないときは、次の GET に回す
        if (photoIds.length > budget && (photoIds.length <= STALE_READ_MAX || budget < STALE_READ_MAX)) continue;
        const take = photoIds.slice(0, budget);
        budget -= take.length;
        picked.push([l, take]);
    }
    const ids = [...new Set(picked.flatMap(([, p]) => p))];
    const rows = new Map<string, { ok: true; item?: Record<string, unknown> } | { ok: false }>();
    await Promise.all(ids.map(async (id) => {
        try {
            const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id }, ConsistentRead: true }));
            rows.set(id, { ok: true, item: res.Item as Record<string, unknown> | undefined });
        } catch (e) {
            console.error(`trunk: 外しの確かめの読みに失敗しました（${uid}・${id}）:`, e);
            rows.set(id, { ok: false });
        }
    }));
    const out = new Set<string>();
    for (const [l, photoIds] of picked) {
        const read = photoIds.map((id) => rows.get(id));
        // 1枚でも読めなかったら外さない（見せない側に倒すのは「確かめられた」ときだけ）
        if (read.some((r) => !r || !r.ok)) continue;
        const [self, ...siblings] = read.map((r) => (r && r.ok ? r.item : undefined));
        const siblingPlaces = new Set(siblings.filter((r): r is Record<string, unknown> => !!r && placeOkFor(l.place, r, uid))
            .map(() => placeKey(l.place)));
        if (!placeOkNext(l, self, uid, siblingPlaces)) out.add(l.id);
    }
    return out;
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
 *     PUT    /user/trunk/labels/{id}/place { x, y, rot } → view
 *     POST   /user/trunk/labels/{id}/unstick     → view
 *     POST   /user/trunk/gacha                   → { part, duplicate, fragments, coins }
 *     POST   /user/trunk/parts/exchange { partId } → view ＋ part
 *     PUT    /user/trunk/equip { handle?, …, pins?, patches? } → view
 *     GET    /users/{uid}/trunk                  → 人のトランク（`readTheirTrunk`・見せないときは 404）
 *     POST   /user/trunk/welcome                 → { granted, added, coins }（はじめての硬貨・一度きり）
 *     POST   /user/trunk/reward { kind }         → { granted, added, coins, rewarded }（アイコン・カバーのお礼・それぞれ一度きり・#304）
 *
 * 失敗は `{ error, code }`（`code` は英字の印: notFound / full / storage / proOnly / pendingReroll /
 * noRerollsLeft / noPending / badSeed / badModel / badRequest / badPlace / notStuck / noCoins /
 * badPart / owned / notEnoughFragments / badKind / notOwned）。
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");
    const route = event.routeKey;
    const id = event.pathParameters?.id;
    const now = new Date();
    try {
        if (route === "GET /users/{uid}/trunk") {
            const target = event.pathParameters?.uid;
            if (typeof target !== "string" || !isUserId(target)) return jsonError(404, "見つかりません", "notFound");
            try {
                return ok(await readTheirTrunk(uid, target, now));
            } catch (e) {
                if (e instanceof HiddenTrunk) return jsonError(404, "見つかりません", "notFound");
                throw e;
            }
        }
        // Pro かどうかは要らない（users テーブルを読む回数を増やさない）
        if (route === "POST /user/trunk/welcome") {
            // アプリは id token を送る（`APIClient.swift`）。Cognito の id token は `auth_time`（いまのログインを始めた時刻）を持つ
            return ok(await welcomeCoins(uid, now, event.requestContext.authorizer.jwt.claims.auth_time));
        }
        if (route === "POST /user/trunk/reward") {
            const kind = body(event).kind;
            if (!isRewardKind(kind)) return jsonError(400, "不正なリクエスト", "badKind");
            return ok(await rewardCoins(uid, kind, now));
        }
        const me = await readProfileBits(uid);
        // 退会した本人（期限内のトークン）にトランクを書かせない（`liveCaller.ts`）。
        // **Pro の判定の読みに相乗りする**（users の読みを増やさない）。GET /user/trunk も
        // 控え（posts）を書き直すので止める。ラベルを外す（DELETE）だけは削除の系統として通す。
        // welcome・reward は上で自分の読みで墓石を見ている（硬貨を配らない・200）
        if (!route.startsWith("DELETE ")) {
            const gone = goneIfDeleted(me);
            if (gone) return gone;
        }
        const pro = isPro(me, now.getTime());
        if (route === "GET /user/trunk") {
            const [rows, photos] = await Promise.all([
                readTrunkRows(uid),
                listMyPhotos(uid),
            ]);
            let doc = parseTrunk(rows.main, rows.ledger);
            // 自分の口の posts は今までどおり（iOS の古び方・節目に使う）。控えに書くのは人の口に出す数
            // ＝誰にでも見える公開の投稿だけ（`countPublicPosts`）
            const posts = countPosts(photos);
            const publicPosts = countPublicPosts(photos as unknown as Record<string, unknown>[]);
            // 外し損ねた印をここで外す（本人の写真はもう全部読んでいる。付ける側はやらない）
            // 一覧で挙がった候補だけ強い読みで読み直してから外す（索引の古い姿で正しい印を外さない）
            const candidates = stalePlaceOkCandidates(doc, photos as unknown as Record<string, unknown>[], uid);
            const stale = candidates.size > 0
                ? await confirmStale(doc, candidates, uid).catch((e) => {
                    // 外しは最善の努力。落ちたら外さない（記録だけ・トランクの画面は出す）
                    console.error(`trunk: 外しの確かめに失敗しました（${uid}）:`, e);
                    return new Set<string>();
                })
                : new Set<string>();
            if (rows.main && (doc.posts !== publicPosts || stale.size > 0)) {
                await noteTrunkQuietly(uid, publicPosts, stale);
                if (stale.size > 0) doc = setPlaceOk(doc, (l) => stale.has(l.id), () => false) ?? doc;
            }
            return ok({ ...view(doc, pro, now), posts });
        }
        if (route === "PUT /user/trunk/model") {
            const doc = await mutateTrunk(uid, pro, now, modelMutation(body(event).model));
            return ok(view(doc, pro, now));
        }
        if (route === "PUT /user/trunk/settings") {
            const b = body(event);
            // 乗車券の写真は先に確かめる（本人の公開写真だけ）。形の誤りは mutation が 400 にする
            let ticketOk = true;
            if (b.ticket && typeof b.ticket === "object" && typeof (b.ticket as { photoId?: unknown }).photoId === "string") {
                const photoId = (b.ticket as { photoId: string }).photoId;
                if (PHOTO_ID_RE.test(photoId)) {
                    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId }, ConsistentRead: true }));
                    ticketOk = isOwnPublicPhoto(res.Item as Record<string, unknown> | undefined, uid);
                }
            }
            const doc = await mutateTrunk(uid, pro, now, settingsMutation(b, ticketOk));
            return ok(view(doc, pro, now));
        }
        if (route === "POST /user/trunk/gacha") {
            const out: { result?: GachaResult } = {};
            await mutateTrunk(uid, pro, now, gachaMutation(rollGacha(), out));
            return ok(out.result);
        }
        if (route === "POST /user/trunk/parts/exchange") {
            const partId = body(event).partId;
            const doc = await mutateTrunk(uid, pro, now, exchangeMutation(partId));
            return ok({ ...view(doc, pro, now), part: partOf(partId) });
        }
        if (route === "PUT /user/trunk/equip") {
            const doc = await mutateTrunk(uid, pro, now, equipMutation(body(event)));
            return ok(view(doc, pro, now));
        }
        if (typeof id !== "string" || !LABEL_ID_RE.test(id)) return jsonError(400, "不正なリクエスト", "badRequest");
        let fn: Mutation;
        switch (route) {
            case "POST /user/trunk/labels/{id}/stick": fn = stickMutation(id, parsePos(body(event))); break;
            case "PUT /user/trunk/labels/{id}/place": fn = placeMutation(id, parsePos(body(event))); break;
            case "POST /user/trunk/labels/{id}/unstick": fn = unstickMutation(id); break;
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

/**
 * 2行をそのまま読む（並べて Get。BatchGetItem の権限は持たない）。
 * **強い読み**（ConsistentRead）——書き込みの土台にするので、直前の書き込みを見落とすと
 * 同じ rev で書きに行って競合の往復が増える（結果整合の読みでも rev 条件で守られるが、やり直しが無駄に増える）
 */
async function readTrunkRows(uid: string): Promise<{ main?: Record<string, unknown>; ledger?: Record<string, unknown> }> {
    const [a, b] = await Promise.all([
        ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: trunkId(uid) }, ConsistentRead: true })),
        ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: trunkLedgerId(uid) }, ConsistentRead: true })),
    ]);
    return { main: a.Item as Record<string, unknown> | undefined, ledger: b.Item as Record<string, unknown> | undefined };
}

const TRUNK_WRITE_ATTEMPTS = 4;
const TRUNK_RETRY_BASE_MS = 25;

/** rev 条件（`userList.ts` の `updateUserRow` と同じ決まり。rev を持たない古い行も通す） */
const revGuard = (rev: number) => (rev === 0
    ? "attribute_not_exists(id) OR attribute_not_exists(rev) OR rev = :rev"
    : "rev = :rev");
const revOf = (item: Record<string, unknown> | undefined) => (typeof item?.rev === "number" ? item.rev : 0);

/**
 * 2行を読む → 直す → **変わった行は Put・変わらない行は ConditionCheck**（どちらも rev 条件）を
 * 1つの TransactWriteItems で書く。片方だけ書き換わって食い違う隙を作らない。
 * 古い形（台帳が trunk# の中にある）は、書くときに必ず両方 Put して分ける。
 * 競合（TransactionCanceledException）は読み直してやり直し、尽きたら `UserListError`。
 *
 * @param fn 今の形（`exists` はどちらかの行が在るか）。変えないなら null。副作用を持たせない（やり直しで再び呼ぶ）
 */
async function updateTrunk(uid: string, fn: (doc: TrunkDoc, exists: boolean) => TrunkDoc | null): Promise<void> {
    for (let attempt = 0; attempt < TRUNK_WRITE_ATTEMPTS; attempt++) {
        const rows = await readTrunkRows(uid);
        const doc = parseTrunk(rows.main, rows.ledger);
        const next = fn(doc, !!rows.main || !!rows.ledger);
        if (!next) return;
        const before = serializeRows(doc);
        const after = serializeRows(next);
        const legacy = !rows.ledger && !!rows.main && LEDGER_KEYS.some((k) => k in rows.main!);
        const changed = {
            main: legacy || JSON.stringify(before.main) !== JSON.stringify(after.main),
            ledger: legacy || JSON.stringify(before.ledger) !== JSON.stringify(after.ledger),
        };
        if (!changed.main && !changed.ledger) return;
        const at = new Date().toISOString();
        const item = (id: string, raw: Record<string, unknown> | undefined, body: Record<string, unknown>, isChanged: boolean) => {
            const rev = revOf(raw);
            const cond = { ConditionExpression: revGuard(rev), ExpressionAttributeValues: { ":rev": rev } };
            return isChanged
                ? { Put: { TableName: PHOTOS_TABLE, Item: { ...body, id, uid, rev: rev + 1, updatedAt: at }, ...cond } }
                : { ConditionCheck: { TableName: PHOTOS_TABLE, Key: { id }, ...cond } };
        };
        try {
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    item(trunkId(uid), rows.main, after.main, changed.main),
                    item(trunkLedgerId(uid), rows.ledger, after.ledger, changed.ledger),
                ],
            }));
            return;
        } catch (e) {
            if ((e as { name?: string }).name !== "TransactionCanceledException") throw e;
            if (attempt < TRUNK_WRITE_ATTEMPTS - 1) {
                await new Promise((r) => setTimeout(r, TRUNK_RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random())));
            }
        }
    }
    throw new UserListError(`${trunkId(uid)} の書き込みが競合し続けました`);
}

function ok(payload: unknown) {
    return { statusCode: 200, headers: NO_STORE, body: JSON.stringify(payload) };
}
