import type { Story } from "./stories";

/**
 * ハイライト（アーカイブのストーリーを束ねて、マイページの輪に置く）。
 *
 * **サーバーと対**（`api-user/src/highlights.ts`）。クライアントから
 * `api-user` は import できないので複製する——ずれていないことは
 * `scripts/__tests__/highlightParity.test.ts` が数値そのものを突き合わせる
 * （`STORY_REACTIONS` と同じ手）。
 *
 * 🔴 **ハイライトは本人とフォロワーだけが見る**（`canSeeHighlights`）。
 * 中身はストーリーそのもので、ストーリーはフォロワーにしか出ない
 * （2026-09-22・owner の判断。経緯は `api-user/src/storyVisibility.ts`）。
 * 見せる相手が同じなので、**入れるときに公開範囲で断ることはもう無い**。
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
    return null;
}
