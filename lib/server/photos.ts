// lib/server/photos.ts
// ビルド時（サーバー）に photos.json を読み込む共通ローダー。
// /photo/[id] と同じ方針: app/data/photos.json があればそれを、無ければバンドル済みデータを使う。
// ※ fs を使うためサーバーコンポーネント／ルートからのみ import すること。

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import RAW_PHOTOS from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";
import { sortByNewest } from "@/lib/utils/photoOrder";
import { siteConfig } from "@/lib/utils/seo";

/**
 * 公開してはいけない項目（scripts/sync-photos-from-ddb.js の PRIVATE_FIELDS と対）。
 * ここで読んだものは静的HTML と RSC ペイロードに載る＝全員に配られるため、
 * 古い photos.json が残っていても漏れないように、読み出し側でも落とす。
 * srcOriginal は EXIF を落とす前の原本（GPS 入り）のURL。
 */
// `staticStale`（静的ページの掃除が届いていないという内部の印）も落とす。
// 付くのは非公開の写真だけだが、**再公開の順序次第で公開中の行に残る**
// ——非公開化が届かず印が立ち、そのあとの再公開が畳まれると
// `published: true` のまま印が残り、この口から読める。
// **`publicFeed` も落とす。** 公開一覧用 GSI に載せるための**内部の印**で、
// 段階4のあとは「一覧に載っているかどうか」そのものになる。外に出す理由が
// 無い（`staticStale` を同じ理由で落としているのと対）。
// **`keptFrom` も落とす。** ストーリーから残した写真に付く内部の印
// （元のストーリーのID）で、削除の後始末が辿るためだけにある。
// `api/src/photos.ts` と `scripts/sync-photos-from-ddb.js` は落として
// いるのに**ここだけ落としていなかった**——3つの写しを突き合わせる
// テストが無かったので、ずれても誰も落ちない。いまは書き手（sync）が
// 落とすので実際には漏れていないが、**二重の守りの片方が欠けていた**。
// 3つの一致は `scripts/__tests__/privateFieldsParity.test.ts` が縛る。
const PRIVATE_FIELDS = ["srcOriginal", "key", "staticStale", "publicFeed", "keptFrom"] as const;

export function stripPrivateFields(photos: Photo[]): Photo[] {
    return photos.map((p) => {
        const out = { ...p } as Photo & Record<string, unknown>;
        for (const f of PRIVATE_FIELDS) delete out[f];
        return out;
    });
}

export async function loadAllPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        try {
            return stripPrivateFields(JSON.parse(await readFile(photosDataPath, "utf-8")) as Photo[]);
        } catch {
            // 破損時はバンドル済みへフォールバック
        }
    }
    return stripPrivateFields(RAW_PHOTOS as Photo[]);
}

/**
 * OGP・Twitter カードに出す既定の画像。**ビルド時に決める。**
 *
 * それまでは `siteConfig.ogImage = "/images/og-image.jpg"` の固定値だったが、
 * **そのファイルはリポジトリにもビルド成果物にも存在しない**
 * （`public/images/` にあるのは `me-portrait.jpg` だけで、git の全履歴にも
 * 一度も現れない）。それでも16ページがこの URL を OGP 画像として出して
 * いたので、**トップページを SNS・LINE・Slack に貼っても画像が出ない**
 * ——写真が主役のサイトとしては痛い。`Organization` の `logo` も同じ
 * URL を指していた。
 *
 * 画像を新しく作るのはデザインの判断になるので、**サイトが既に持って
 * いるもの**から選ぶ: 一番新しい公開写真。写真ギャラリーの共有カードに
 * 出るべきものであり、ビルドのたびに最新へ入れ替わる。
 *
 * **寸法は申告しない。** 写真の縦横比はまちまちで、`photos.json` は
 * `width`/`height` を持っていない（実測 0/30）。ユーザーページと写真
 * ページで同じ理由から寸法をやめたのと同じ扱い。
 *
 * 公開写真が1枚も無いときだけ、PWA のアイコン（実在する）に落とす。
 */
export async function resolveOgImage(siteUrl: string, source?: () => Promise<Photo[]>): Promise<string> {
    try {
        // 既定はビルド時の一覧。`source` は差し替え用（テストから
        // 「写真が無い」「非公開だけ」を作るため——`loadAllPhotos` は
        // ディスクの `app/data/photos.json` を読むのでモックが効かない）
        const photos = await (source ?? loadAllPhotos)();
        const newest = sortByNewest(photos.filter((p) => p.published !== false && p.src))[0];
        if (newest?.src) {
            return newest.src.startsWith("http") ? newest.src : `${siteUrl}${newest.src}`;
        }
    } catch {
        // 読めなければアイコンに落とす（メタ情報のために本体を落とさない）
    }
    // 落とし先は `siteConfig.ogImage`（同じパスを散らさない）
    return `${siteUrl}${siteConfig.ogImage}`;
}
