/**
 * **外に出さない項目（api-user の中の1か所）。**
 *
 * `lib/server/photos.ts` ／ `api/src/photos.ts` ／
 * `scripts/sync-photos-from-ddb.js` と同じ一覧で、
 * `scripts/__tests__/privateFieldsParity.test.ts` が突き合わせる。
 *
 * もとは `restrictedFeed.ts` の中に在った。公開の一覧（`GET /feed`・`feed.ts`）も
 * 同じふるいが要るので、**写しを増やさずに**ここへ切り出して2つの口で使う。
 *
 * - 絞った一覧（`GET /feed/restricted`）は**見せてよい相手にだけ返す口**だが、
 *   それは「行をそのまま渡してよい」という意味ではない。とくに `srcOriginal` は
 *   **EXIF を落とす前の原本**（GPS 入り）のURLで、フォロワーであっても
 *   撮影者の自宅が割れる粒度の情報を渡すことになる。
 * - 公開の一覧（`GET /feed`）は**静的な `photos.json` と同じ形**で返すので、
 *   sync が余分に落とす `commentCount` も落とす（`STATIC_LIST_ONLY_FIELDS`）。
 */
export const PRIVATE_FIELDS = ["srcOriginal", "key", "staticStale", "publicFeed", "keptFrom"] as const;

/**
 * **静的な一覧（`photos.json`）と、それと同じ形で返す `GET /feed` だけが余分に落とすもの。**
 *
 * `commentCount` は秘密ではなく**古くなる数**——静的HTMLに焼くと古い数字が
 * 残るので sync が落としている（NUM-3）。`GET /feed` は「`photos.json` の
 * 続きのページ」として同じ形で読まれるので、同じく載せない
 * （載せると、静的な1ページ目と API の2ページ目で項目の有無が割れる）。
 *
 * `PRIVATE_FIELDS` とこれを合わせたものが sync の `PRIVATE_FIELDS` と一致することを
 * `privateFieldsParity.test.ts` が見る。
 */
export const STATIC_LIST_ONLY_FIELDS = ["commentCount"] as const;

/** 行から外に出さない項目を落とす（渡すのは写し。元の行は触らない） */
export function stripPrivate(item: Record<string, unknown>): Record<string, unknown> {
    const out = { ...item };
    for (const f of PRIVATE_FIELDS) delete out[f];
    return out;
}

/** `photos.json` と同じ項目にする（`stripPrivate` ＋ 静的一覧だけが落とすもの） */
export function stripForPublicList(item: Record<string, unknown>): Record<string, unknown> {
    const out = stripPrivate(item);
    for (const f of STATIC_LIST_ONLY_FIELDS) delete out[f];
    return out;
}
