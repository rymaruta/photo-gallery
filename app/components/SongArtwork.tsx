"use client";

import { safeSongArtworkUrl } from "../../lib/utils/mediaHosts";

/**
 * 曲のアートワーク。**出すときにも許可ホストを確かめる。**
 *
 * サーバーの許可リストは「これから保存する値」にしか効かない
 * （`mediaHosts.ts` の冒頭を参照）。許可リストを入れる前に保存された曲は
 * 任意のホストのまま残りうるので、読み込む側でも見る。とくに
 * `GET /user/profile` は保存された行をそのまま返す——公開側の
 * `getPublicProfile` は `withCheckedSongUrls` を通しているのに、
 * **本人の編集画面だけ素通り**していた（サーバーもクライアントも
 * この1経路だけ両方無かった）。
 *
 * **落とすのは表示だけ。** 復元した値そのものを落としてはいけない
 * ——保存の差分の比較先に入り「利用者が消した」と読まれる
 * （`/user/profile` の 418・424・470 行がその値を保存の本文に載せる。
 * プロフィールの曲で一度踏んだ形）。
 *
 * 通らなかったときは**同じ大きさの箱**を出す（`bg-*` は呼び出し側の
 * className に入っているので、読み込みに失敗したときと同じ見た目になる）。
 */
export default function SongArtwork({ src, className }: { src?: string; className: string }) {
    const safe = safeSongArtworkUrl(src);
    if (!safe) return <div className={className} aria-hidden="true" />;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={safe} alt="" loading="lazy" className={className} />;
}
