/**
 * 人の構造化データ（`Person`）の**節点の名前**。
 *
 * **同じ人だと機械に言い切るための1行。**
 *
 * この人の `Person` は**2か所**から出る:
 *   - `/users/<id>`（`personEntity`）… ProfilePage の本人
 *   - 写真ページ30枚（`seo.ts` の `creator` / `author`）
 *
 * どちらも名前と `url` は同じだが、**`@id` が無いと別々の無名の節点**に
 * なり、同じ実体かどうかは受け取る側の推測に委ねられる。人名で1位を
 * 取りたいときに効くのは「この31ページが指しているのは1人だ」と
 * 言い切れること（`url` を足したのと同じ理由の、その先）。
 *
 * **プロフィールの URL そのものは使えない。** それは
 * `ProfilePage`（ページ）の識別子で、人ではない。同じ `@id` を人と
 * ページの両方に付けると「ページ＝人」と言うことになる。
 * 断片（`#person`）を足して別の節点にする。
 *
 * **何も import しない。** `seo.ts` と `personEntity.ts` の両方が読むが、
 * `personEntity.ts` は `seo.ts` の `siteConfig` を読むので、どちらかに
 * 置くと import が輪になる（`nameVariants.ts` と同じ理由）。
 */
export function personNodeId(profileUrl: string): string {
    return `${profileUrl}#person`;
}
