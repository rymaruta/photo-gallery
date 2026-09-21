import type { Story } from "./stories";

/**
 * ハイライト（アーカイブのストーリーを束ねて、マイページの輪に置く）。
 *
 * **サーバーと対**（`api-user/src/highlights.ts`）。クライアントから
 * `api-user` は import できないので複製する——ずれていないことは
 * `scripts/__tests__/highlightParity.test.ts` が数値そのものを突き合わせる
 * （`STORY_VISIBILITIES` と同じ手）。
 *
 * **ハイライトは誰でも見られる。** だから入れられるのは「全員に公開」で
 * 投稿したアーカイブだけ（サーバーが断る。画面はそのタイルを押せなくして
 * 理由を出す）。
 */

/** 1人が持てるハイライトの数 */
export const HIGHLIGHTS_PER_USER = 20;
/** 1つのハイライトに入れる数 */
export const STORIES_PER_HIGHLIGHT = 100;
/** 題の最大長 */
export const HIGHLIGHT_TITLE_MAX = 30;

/** マイページの輪1つ（`GET /highlights/{userId}`） */
export type HighlightSummary = {
    id: string;
    title: string;
    count: number;
    /** 表紙。中身が全部消えていると null（画面はアイコンで埋める） */
    cover: { src: string; mediaType?: string } | null;
};

/** 開いたときの中身（`GET /highlights/{userId}/{id}`）。並びは保存した順 */
export type HighlightDetail = {
    id: string;
    title: string;
    coverStoryId?: string;
    items: Story[];
};

/**
 * そのストーリーをハイライトに入れられるか（サーバーの `checkStories` と同じ判定）。
 * 画面は入れられないタイルを押せなくして理由を添える——押してから
 * 断られるボタンを置かない
 */
export function highlightRejection(s: Story, isJa: boolean): string | null {
    if (s.archive !== true) {
        return isJa ? "「アーカイブに自動保存」が入っていない投稿は入れられません"
            : "Only stories saved to your archive can be added";
    }
    if (s.visibility !== undefined && s.visibility !== "public") {
        return isJa ? "フォロワーのみの投稿は入れられません（ハイライトは誰でも見られます）"
            : "Followers-only stories can't be added (highlights are visible to everyone)";
    }
    return null;
}
