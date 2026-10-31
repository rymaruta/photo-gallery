"use client";

import React, { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { photosWithCoords, type MapSelection } from "../components/PhotoMap";
import MapPhotoSheet from "../map/MapPhotoSheet";
import { EmptyState } from "../components/StateViews";
import type { Photo } from "@/lib/data/photos";

// 地図（Leaflet）は押して開いたときだけ読む。人のページの最初の JS に載せない
const PhotoMap = dynamic(() => import("../components/PhotoMap"), { ssr: false });

/**
 * **人のページの「マップ」の札**（iOS の `ProfileTab.map` → `MyPhotosMap`・2026-10-31 束 1 U6・U9）。
 * その人の公開写真のうち座標のあるものだけを、撮影地マップと同じピン・同じ下のシートで出す。
 * 以前の Web は「訪れた場所」のチップ（多い順に 3 つ）だった——iOS はチップを外し、この札で地図に出す。
 * 座標のある写真が 1 枚も無ければ空の案内（地図の枠を出さない）
 */
export default function ProfileMapTab({ photos, locale }: { photos: readonly Photo[]; locale: "ja" | "en" }) {
    const pins = useMemo(() => photosWithCoords(photos), [photos]);
    const [sheet, setSheet] = useState<MapSelection | null>(null);
    const onSelect = useCallback((s: MapSelection | null) => setSheet(s), []);

    if (pins.length === 0) {
        return (
            <EmptyState
                className="py-16"
                message={locale === "en" ? "No photos with a location yet." : "撮影地の分かる写真はまだありません。"}
                testId="profile-map-empty"
            />
        );
    }
    return (
        <div className="relative" data-testid="profile-map">
            <PhotoMap
                photos={pins}
                locale={locale}
                onSelect={onSelect}
                selectedId={sheet ? sheet.photos[sheet.index]?.id ?? null : null}
                sheetOpen={!!sheet}
                className="h-[62vh] min-h-[320px] lg:h-[560px]"
            />
            {sheet && (
                <MapPhotoSheet
                    photos={sheet.photos}
                    index={sheet.index}
                    onIndexChange={(i) => setSheet((s) => (s ? { ...s, index: i } : s))}
                    onClose={() => setSheet(null)}
                    locale={locale}
                />
            )}
        </div>
    );
}
