// lib/server/photos.ts
// ビルド時（サーバー）に photos.json を読み込む共通ローダー。
// /photo/[id] と同じ方針: app/data/photos.json があればそれを、無ければバンドル済みデータを使う。
// ※ fs を使うためサーバーコンポーネント／ルートからのみ import すること。

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import RAW_PHOTOS from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";

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
// `inspiredNotified`（「この写真を見て撮影」の通知を送った印・`api-user/src/inspired.ts`）も落とす。
// 内部の印で、外に出す理由が無い。**元の写真の ID `inspiredBy` は落とさない**（画面が使う）
// `firstPublishedAt`（初めて公開した時刻・旅のトランクの印・`api-user/src/trunk.ts`）も落とす。
// 2026-10-17 判断を変更: 中の印なので隠す（ラベルを配るかどうかの判定にだけ使う）
const PRIVATE_FIELDS = ["srcOriginal", "key", "staticStale", "publicFeed", "keptFrom", "inspiredNotified", "firstPublishedAt"] as const;

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

// `resolveOgImage`（一番新しい公開写真を共有カードに出す）は 2026-10-31 に外した。
// トップの共有カードと検索結果が利用者の最新の投稿に左右されていた（#432 の 4）。
// 代わりは `lib/utils/seo.ts` の `SHARE_IMAGE`（固定の代表画像）
