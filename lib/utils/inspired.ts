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
 * ⚠️ **ブロックは見ない。** 公開の一覧には閲覧者が居ない（静的なページ）。
 * Web の他の公開ページ（一覧・撮影地・タグ）と同じ扱い。ブロックまで見る口は
 * アプリ向けの `GET /user/inspired/{id}`（`api-user/src/inspired.ts`）。
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
