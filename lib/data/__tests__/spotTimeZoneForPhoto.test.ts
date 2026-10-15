import { describe, it, expect } from "vitest";
import { SPOTS } from "../spots";
import { visibleSpots } from "../../utils/spotGuide";
import { spotTimeZoneForPhoto } from "../spotLink";
import { spotTimeZone } from "../../utils/sunTimes";

/**
 * 写真が指すスポットの時刻帯（写真の詳細の「次のゴールデンアワー」をその土地の時計で言う）。
 * 引き方は `spotLinkForPhoto` と同じ `spotId` だけ。
 */
describe("spotTimeZoneForPhoto", () => {
    it("公開されているスポットは、台帳の時刻帯（無ければ国）で引ける", () => {
        const spot = visibleSpots(SPOTS)[0];
        expect(spot, "公開のスポットが1件も無い（この確認が空回りしている）").toBeTruthy();
        expect(spotTimeZoneForPhoto(spot.spotId)).toBe(spotTimeZone(spot.timeZone, spot.region?.country));
    });

    it("spotId が無い・台帳に無いなら null", () => {
        expect(spotTimeZoneForPhoto(undefined)).toBeNull();
        expect(spotTimeZoneForPhoto("SPOT-does-not-exist")).toBeNull();
    });
});
