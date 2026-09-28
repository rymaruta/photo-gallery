/**
 * **写真の公開範囲**（iOS の `Audience.swift` と同じ三択・同じ文言）。
 *
 * サーバー（`api-user/src/sanitize.ts` の `sanitizeAudience`）が受けるのは
 * `followers` / `closeFriends` だけで、**付いていない＝全体に公開**。
 *
 * 絞った写真は静的サイト（`app/data/photos.json`）に載らない＝**個別ページも
 * サイトマップも作られず、検索から辿り着けない**（`scripts/sync-photos-from-ddb.js`
 * が落とす）。このサイトの主戦場は検索流入なので（CLAUDE.md）、**既定は全体に公開**で、
 * 選ぶ前にそのことを言う。
 */
export type Audience = "everyone" | "followers" | "closeFriends";

export const AUDIENCES: ReadonlyArray<{
    value: Audience;
    ja: string; en: string;
    noteJa: string; noteEn: string;
}> = [
    {
        value: "everyone", ja: "全体に公開", en: "Everyone",
        noteJa: "ウェブサイトにも載り、検索から見つけてもらえます", noteEn: "Also on the website, findable in search",
    },
    {
        value: "followers", ja: "フォロワーのみ", en: "Followers",
        noteJa: "自分をフォローしている人だけ。ウェブサイトには載りません", noteEn: "Only your followers — not on the website",
    },
    {
        value: "closeFriends", ja: "親しい友達", en: "Close friends",
        noteJa: "自分が選んだ人だけ。ウェブサイトには載りません", noteEn: "Only people you picked — not on the website",
    },
];

/** サーバーから来た値を読む。**知らない値は全体に公開**（サーバーの `sanitizeAudience` と同じ倒し方） */
export function readAudience(value: unknown): Audience {
    return value === "followers" || value === "closeFriends" ? value : "everyone";
}

/** 新規投稿（`/upload/save`）に載せる値。**全体に公開は送らない**（属性を書かない形に揃える） */
export function audienceForSave(a: Audience): { audience?: "followers" | "closeFriends" } {
    return a === "everyone" ? {} : { audience: a };
}

/**
 * 更新（`PUT /photos/{id}`）に載せる値。**全体に公開は空文字**——キーごと
 * 消すとサーバーは既にある印を残す＝**絞りを外せなくなる**（iOS の `patchValue`）
 */
export function audienceForPatch(a: Audience): { audience: string } {
    return { audience: a === "everyone" ? "" : a };
}
