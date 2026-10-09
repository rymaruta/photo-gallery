import React from "react";
import HomeEntryRow from "./HomeEntryRow";
import { ROUTES } from "../../lib/routes";

/**
 * ホームから撮影スポットのガイド（`/spots`）への入口。**1行だけ**（形は `HomeEntryRow`）。
 *
 * それまでトップから `/spots` へ行く道はフッターの1本しか無かった。
 * 今日の一問の行のすぐ下（どのタブでも同じ位置）に置く。
 *
 * 🔴 **台帳（`SPOTS`）をここで読まない。** この部品はクライアント側で描かれるので、
 * 読めば数千件の JSON がトップの JS に乗る。件数・写真も出さない——文言だけの静的な行。
 */
export default function SpotsEntry({ locale }: { locale: "ja" | "en" }) {
    const en = locale === "en";
    return (
        <HomeEntryRow
            href={ROUTES.SPOTS}
            testId="home-spots-entry"
            eyebrow={en ? "Photo spots" : "撮影スポット"}
            text={en ? "Guides to places worth shooting" : "撮りに行ける場所のガイド"}
        />
    );
}
