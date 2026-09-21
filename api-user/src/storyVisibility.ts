/**
 * ストーリーの公開設定。**規則を1か所に置く**ための小さな module。
 *
 * 書く側（`createStory`）と読む側（`getStories` / `viewStory` /
 * `postStoryReply`）で同じ判定を別々に書くと静かにずれる
 * ——ずれる向きが「狭いつもりが全員に出る」なので、値の解釈は
 * **必ずこの1本を通す**。
 *
 * `stories.ts` に置けない: `stories.ts` は `storyReplies.ts` を import して
 * いるので、`storyReplies.ts` から引くと輪になる（`blockCheck.ts` /
 * `followCheck.ts` を切り出したのと同じ理由）。
 */

/** 全員に公開（既定。ログイン中の全員のトレイに出る） */
export const STORY_PUBLIC = "public";
/** フォロワーのみ（投稿者をフォローしている人と本人だけ） */
export const STORY_FOLLOWERS_ONLY = "followers";

export type StoryVisibility = typeof STORY_PUBLIC | typeof STORY_FOLLOWERS_ONLY;

/**
 * 保存された値／受け取った値を、画面と門が使う2値に均す。
 *
 * **無い＝全員に公開。** この列が生まれる前の行は持っていないので、
 * ここを逆にすると**既存のストーリーが全部フォロワー限定になる**
 * （移行を走らせずに済ませるための線）。
 *
 * **知らない値は「フォロワーのみ」に倒す。** 逆にすると、あとで
 * 「親しい友達」を足したとき、**その値を知らない版のサーバーに当たった
 * 投稿が全員に出る**。公開範囲は間違える向きが決まっていて、
 * 狭すぎる側は「見えない」で済むが、広すぎる側は取り返せない。
 */
export function storyVisibility(raw: unknown): StoryVisibility {
    if (raw === undefined || raw === null || raw === STORY_PUBLIC) return STORY_PUBLIC;
    return STORY_FOLLOWERS_ONLY;
}

/**
 * 返信を受け付けるか。**既定は受け付ける**（返信が生まれたときからの姿）。
 *
 * `false` を明示したときだけ断る——`0` や `"false"` のような値で
 * 黙って閉じない（閉じたつもりが開いている、の逆も作らない）。
 */
export function storyAllowsReplies(raw: unknown): boolean {
    return raw !== false;
}
