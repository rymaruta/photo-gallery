// lib/hooks/usePhotos.ts
// 写真一覧をAPIから取得する共通フック（AbortController対応）

import { usablePhotoRows } from "../utils/apiRows";
import { useState, useEffect } from "react";
import type { Photo } from "../data/photos";
import BASE_PHOTOS_JSON from "@/app/data/photos.json";
import { log } from "../utils/log";

const BASE_PHOTOS = BASE_PHOTOS_JSON as Photo[];

export function usePhotos() {
    // BASE_PHOTOSを初期値とすることで、APIが遅延・失敗しても即時コンテンツ表示を保証する
    const [photos, setPhotos] = useState<Photo[]>(BASE_PHOTOS);
    const loading = false;
    /**
     * **API の一覧で置き換わったか。**
     *
     * 初期値は `app/data/photos.json`（ビルド時のスナップショット）なので、
     * 「配列が空でない」は「一覧が届いた」の代わりにならない。それで代用して
     * いたせいで、ビルド後にアップロードされた写真の共有リンクに対して
     * 「その写真は見つかりませんでした」と**嘘をつき**、しかもその判定を
     * 覚えてしまって**あとから届いても開かなく**なっていた。
     *
     * **失敗したときは true にしない。** 取れなかっただけで「無い」とは
     * 言えないので、判断できないままにしておく（黙る側に倒す）。
     * 定期ビルドは止まっているので、静的JSONは日単位で古い。
     */
    const [loaded, setLoaded] = useState(false);
    /**
     * **取りに行って駄目だったか。** `loaded` は「届いたか」しか言わないので、
     * 失敗した場合は「まだ来ていない」と見分けが付かず、待っている側
     * （共有リンク・通知から開いた `?photo=`）が**永久に黙って待つ**。
     * 実測: 応答を保持すると、3秒・10秒・30秒のいずれでもモーダルも
     * トーストも出ず、`?photo=` が URL に残ったままだった
     */
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        const load = async () => {
            try {
                const { publicFetch } = await import("../utils/api");
                const response = await publicFetch("/photos", {
                    signal: controller.signal,
                });
                if (response.ok) {
                    // **読めない行は落としてから入れる。** 以前は
                    // `Array.isArray` までしか見ておらず、100件中1件が
                    // `null` なだけで描画中に落ち、ページ全体が
                    // `ErrorBoundary` のカードになった（実測で確認）
                    const data = usablePhotoRows<Photo>(await response.json(), "GET /photos");
                    // APIが空配列を返した場合はBASE_PHOTOSを維持する
                    if (data && data.length > 0) {
                        setPhotos(data);
                    }
                    // **`loaded` は「届いたか」だけを言う。中身の有無ではない。**
                    //
                    // 以前は `data.length > 0` の中で立てていたので、公開写真が
                    // 0件の環境（新しい環境・全部非公開にした・全部消した）では
                    // **永久に false のまま**だった。`GalleryPageClient` は
                    // 「届くまでは『見つかりません』と言わない」ために
                    // `photosLoaded` を門にしているので、共有リンク
                    // （`/?photo=<id>`）を踏んでも**モーダルも出ず、無いとも
                    // 言われず、`?photo=` が URL に残ったまま**になる。
                    // 押し直しても同じ。新着写真の唯一の閲覧手段がこの経路。
                    //
                    // 表示する中身は変えない（空で `BASE_PHOTOS` を潰さない）。
                    // 変えるのは「聞けて、答えが返った」を記録するかどうかだけ。
                    if (data) setLoaded(true);
                } else {
                    log.warn("写真の取得に失敗しました", { status: response.status });
                    setFailed(true);
                }
            } catch (error) {
                // 自分で畳んだ中断（画面を離れた）は失敗ではない。
                // 時間切れ（`TimeoutError`）は失敗として伝える
                if ((error as { name?: string }).name !== "AbortError") {
                    log.error("写真取得エラー:", error);
                    setFailed(true);
                }
            }
        };

        void load();
        return () => controller.abort();
    }, []);

    return { photos, loading, loaded, failed };
}
