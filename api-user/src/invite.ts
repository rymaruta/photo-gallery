/**
 * 共同アルバムの招待（トークンの発行・判定・キーの形）。
 *
 * **狙い**: 旅の後に必ず起きる「写真ちょうだい」を製品にする。
 * 招待リンクを1本配れば、同行者がその旅のアルバムに自分の写真を足せる。
 *
 * ここは**判定だけ**を持つ（DynamoDB も HTTP も触らない）。理由は
 * `uploadPolicy.ts` と同じ——判定を素で試せる形にしておくと、
 * 「守ったつもりで守れていない」が変異テストで見える。
 *
 * ## 設計で決めたこと
 *
 * - **リンクは `/j?t=<トークン>`**（パスではなくクエリ）。このサイトは静的
 *   書き出しで `dynamicParams = false`（列挙外は404）なので、`/j/<トークン>`
 *   にすると**全トークンをビルド時に列挙しないと開けない**。
 *   `/?photo=<id>`・`/users?id=` と同じ形で、実績がある。
 * - **未認証で閲覧できる。投稿だけログインを要求する。** 開いた瞬間に
 *   ログインを求めると、拡散の輪がそこで切れる。
 * - **検索には出さない**（招待は私的なリンク）。sitemap にも載せない。
 * - **推測不能にする。** 連番や短い乱数だと、総当たりで他人の旅が読める。
 *   192ビット（24バイト）を base64url にする。
 * - **期限と失効を分けて返す。** 「切れた」「取り消された」「そもそも無い」を
 *   同じ 404 に潰すと、画面が理由を出せない（このリポジトリは
 *   「理由を握り潰す」で何度も事故っている）。
 *
 * ## TTL は使えない
 *
 * このテーブルに **DynamoDB の TTL は設定されていない**
 * （`scripts/provision-env.js` に `TimeToLiveSpecification` が無い。
 * ストーリーも `expiresAt` を自分で見て、掃除は1時間ごとの cron でやっている）。
 * **期限切れは必ずコード側で判定する**——「TTL が消してくれる」前提で
 * 判定を省くと、期限の切れた招待が永久に有効になる。
 */

import { randomBytes } from "node:crypto";

/** 招待の有効期間。旅のあとに配って、忘れた頃には切れている長さ */
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * トークンの長さ（バイト）。
 *
 * 192ビット。**短くしてはいけない**——このトークンだけが「他人の旅を
 * 読めない」ことの根拠で、当たれば中の写真も参加者の名前も見える。
 */
const TOKEN_BYTES = 24;

/** 招待トークンを作る。URL に直接載るので base64url（`+/=` を含まない） */
export function newInviteToken(): string {
    return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * トークンとして受け付けてよい形か。
 *
 * **DynamoDB に投げる前に見る。** 形の違うものを鍵にして引きにいくと、
 * 無駄な読み取りを好きなだけ起こせる（未認証で叩ける口なので）。
 * base64url の文字だけ・長さは 32〜64（24バイトなら32文字）。
 */
export function isValidInviteToken(raw: unknown): raw is string {
    return typeof raw === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(raw);
}

/** 招待の項目のキー */
export const inviteKey = (token: string) => `invite#${token}`;
/** アルバムの項目のキー */
export const albumKey = (albumId: string) => `album#${albumId}`;
/** 参加の印のキー。1人1行なので、参加の有無は GetItem 1回で分かる */
export const albumMemberKey = (albumId: string, userId: string) => `albummember#${albumId}#${userId}`;
/**
 * その人が作ったアルバムの一覧（利用者ごとの文書）。
 *
 * **GSI（`userId-createdAt-index`）には載せない。** アルバムの行に `userId` を
 * 付けると索引に載り、`hasAnyUserItem`（フォローできる相手か）と退会の掃除が
 * **絞り込み無しでその索引を引いている**ので、写真以外の行が紛れ込む経路が
 * 増える（ストーリーが公開一覧に漏れた前例と同じ形）。
 * `following#<uid>`・`notifs#<uid>` と同じ「利用者ごとの1行」にする。
 */
export const albumsOfUserKey = (userId: string) => `albums#${userId}`;

/**
 * 1人が持てるアルバムの数。
 *
 * 上限が無いと、`following` の2000人切り捨てと同じ形になる
 * （黙って落ちて、画面からは直せない）。ここは**1つの項目に入る一覧**なので、
 * DynamoDB の 400KB を超えないことも兼ねる（ID は uuid で36文字なので余裕）。
 */
export const ALBUMS_PER_USER = 50;

/**
 * 1つのアルバムに入れる人数。
 *
 * 旅の同行者を想定した数。**超えたら断る**——黙って切り捨てない。
 */
export const MEMBERS_PER_ALBUM = 50;

/** アルバムの題の最大長（保存する前に切る） */
export const ALBUM_TITLE_MAX = 60;

/**
 * 1つのアルバムに入れる写真の数。
 *
 * **アルバムの行に ID の一覧を持つ**ので、DynamoDB の 400KB を超えない
 * 数にする（uuid 36文字 × 500 ≒ 18KB）。索引を足さずに済ませるための形
 * ——招待の閲覧は `PublicReadRole`（写真テーブルは GetItem のみ）で動くので、
 * 「このアルバムの写真」を Query で引けない。
 */
export const PHOTOS_PER_ALBUM = 500;

/** 招待の項目（DynamoDB に入る形） */
export type InviteItem = {
    id: string;
    albumId?: string;
    createdBy?: string;
    createdAt?: string;
    /** 期限。ISO 文字列。**コード側で必ず見る**（TTL は無い） */
    expiresAt?: string;
    /** 発行者が取り消した */
    revoked?: boolean;
};

/** 招待がいま使えるか。使えないときは**理由を返す** */
export type InviteState = "ok" | "expired" | "revoked" | "notfound" | "broken";

/**
 * 招待の状態を決める。
 *
 * **順番に意味がある。** 取り消しは期限より先に見る——期限が切れた招待を
 * あとから取り消した場合でも「取り消された」と伝えたい（発行者の意図が
 * そちらだから）。
 *
 * `broken` は「行はあるが中身が壊れている」——`albumId` を持たない、
 * 期限が読めない、など。**`ok` に倒さない**（読めないものを通すと、
 * 行き先の無い招待でアルバムを引きに行くことになる）。
 */
export function inviteState(item: InviteItem | null | undefined, now: number): InviteState {
    if (!item) return "notfound";
    if (item.revoked === true) return "revoked";
    if (!item.albumId || typeof item.albumId !== "string") return "broken";
    const exp = Date.parse(item.expiresAt ?? "");
    if (!Number.isFinite(exp)) return "broken";
    return exp > now ? "ok" : "expired";
}

/** 状態に対応する HTTP の状態コードと文言（画面がそのまま出せる） */
export function inviteRejection(state: Exclude<InviteState, "ok">): { statusCode: number; error: string } {
    switch (state) {
        case "expired":
            return { statusCode: 410, error: "この招待リンクは期限が切れています。送った人にもう一度もらってください" };
        case "revoked":
            return { statusCode: 410, error: "この招待リンクは取り消されています" };
        default:
            // notfound / broken は同じ扱い。**「壊れている」を外に見せない**
            // （どのトークンが実在するかを教えることになる）
            return { statusCode: 404, error: "この招待リンクは見つかりません" };
    }
}

/** 発行時の期限（ISO 文字列） */
export const inviteExpiryFrom = (now: number) => new Date(now + INVITE_TTL_MS).toISOString();
