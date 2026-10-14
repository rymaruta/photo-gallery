import type { LocalizedText, Photo } from "@/lib/data/photos";

/**
 * 写真ページの「この写真を見て撮影」の行に出す、元の写真の要約。
 *
 * **写真1枚ぶんを丸ごと渡さない**（RSC ペイロードに載るので、要る項目だけ）。
 */
export type InspiredLink = {
    id: string;
    title?: string | LocalizedText;
    /** 小さい画像（256px → 512px → 原寸の順で、あるもの） */
    thumb: string;
    userId?: string;
    displayName?: string;
};

/**
 * `photo.inspiredBy` が指す元の写真を、**公開の一覧 `all` の中から**探す。
 *
 * Web は追加の読み取りをしない——写真ページは公開の一覧（静的な `photos.json` と
 * `GET /photos`）を既に持っていて、そこに居るのは**公開中・公開範囲を絞っていない・
 * ストーリーでない**写真だけ。居なければ（非公開になった・削除された・絞った）出さない。
 * 一覧が古い行を含んでいても困らないよう、ここでも同じ線をもう一度見る
 * （`api-user/src/feed.ts` の `isPublicListPhoto` と同じ考え方。隠す側に倒す）。
 *
 * **付けた人と元の作者のブロックは、静的な `photos.json` を作るときに落としてある**
 * （`scripts/sync-photos-from-ddb.js` の `pruneInspiredBy`。読み取りは増やさない）。
 * ここでは見ない（印は画面に来ない）——だから写真ページは**ビルド時に解いたものだけ**を
 * 出し、API の一覧（ブロックを見られない）は減らす側にだけ使う（`PhotoPageClient`）。
 * 閲覧者本人とのブロックは見ない（静的なページには閲覧者が居ない。Web の他の公開ページと同じ）。
 * 閲覧者まで見る口はアプリ向けの `GET /user/inspired/{id}`（`api-user/src/inspired.ts`）。
 */
export function inspiredSourceFor(photo: Photo | null | undefined, all: readonly Photo[]): Photo | null {
    const id = photo?.inspiredBy;
    if (!photo || typeof id !== "string" || !id || id === photo.id) return null;
    const source = all.find((p) => p?.id === id);
    if (!source || !source.src) return null;
    const extra = source as Photo & { audience?: unknown; story?: unknown };
    if (source.published === false || extra.story === true) return null;
    if (extra.audience != null && extra.audience !== "") return null;
    return source;
}

/** 行に出す要約へ縮める */
export function toInspiredLink(source: Photo): InspiredLink {
    const name = source.displayName || source.uploaderDisplayName;
    return {
        id: source.id,
        ...(source.title !== undefined ? { title: source.title } : {}),
        thumb: source.thumbSm || source.thumbSrc || source.src,
        ...(source.userId ? { userId: source.userId } : {}),
        ...(name ? { displayName: name } : {}),
    };
}
