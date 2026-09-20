/**
 * 題が無い写真の扱い。
 *
 * owner:「中には、タイトルとか入れずに気軽に投稿する人もいるみたい。
 * タイトルに無題と入ってしまう。一覧を見たときに無題ではなくて、
 * タイトルなくてもいいよ」
 *
 * **「無題」は表示の落とし先ではなく、サーバーが実際に保存していた文字列**
 * だった（`api-user/src/upload.ts` が `sanitizeTitle(title) ?? { ja: "無題" }`）。
 * 保存をやめても**既に上がっている写真には残る**ので、出す側でも落とす。
 *
 * **利用者が自分で「無題」と名付けた回も落ちる。** それは承知のうえ
 * ——その人が言いたいことは「題は無い」なので、結果は同じになる。
 */
const SERVER_PLACEHOLDERS: ReadonlySet<string> = new Set(["無題", "Untitled"]);

/** 題として出してよい文字列。無ければ空（呼ぶ側が「出さない」を決める） */
export function displayTitle(title: string | undefined): string {
    const t = (title ?? "").trim();
    return SERVER_PLACEHOLDERS.has(t) ? "" : t;
}
