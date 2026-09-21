/**
 * ストーリーの期限が切れているか。**判定はここ1か所。**
 *
 * `viewStory` / `keepStory` / `postStoryReply` / `getStoryViewers` /
 * `getStoryReplies` の5か所に同じ比較を写していて、形がずれ始めていた
 * （`typeof === "string"` で見る側と `String(x)` で見る側——数値の epoch が
 * 来たときの答えが逆になる）。猶予を足すような変更が5か所に散ると、
 * 必ず1か所忘れる。
 *
 * **判定は ISO 文字列の比較。** サーバーが自分の時計で書いた `expiresAt`
 * （`createStory`）を、サーバーの時計で見る——端末の時計は使わない
 * （`lib/stories.ts` の `groupStories` がそう決めている理由と同じ）。
 * `expiresAt` を持たない・文字列でない古い行は**有効扱い**（無い理由で
 * 締め出さない。`viewStory` が前からそうしている）。
 */
export function isStoryExpired(item: { expiresAt?: unknown }, now: string = new Date().toISOString()): boolean {
    return typeof item.expiresAt === "string" && item.expiresAt !== "" && item.expiresAt <= now;
}
