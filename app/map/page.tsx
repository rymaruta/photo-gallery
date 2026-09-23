import MapPageClient from "./MapPageClient";
import { spotLinksBySlug } from "@/lib/data/spotLink";

/** 静的ビルド時に公式台帳から公開可能な最小情報だけ抜く。
 * clientの地図へ公式スポットの長文・出典・下書き・非公開GPSを送らない。
 */
export default function MapPage() {
    const published = Object.values(spotLinksBySlug());
    return <MapPageClient spotPreviews={published} />;
}
