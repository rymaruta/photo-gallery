import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCamperSpots, CAMPER_SPOT_CLASSES, CURATED } from "../gen-camper-spots";
import COPY from "../../api-user/src/data/camperSpots.json";

/**
 * とおまわり号のスポットの写し（`api-user/src/data/camperSpots.json`）が台帳と食い違っていないか。
 *
 * 2026-10-18 判断（見直しの指摘）: **台帳との食い違いは落とさず警告（console.warn）にとどめる。** スポットを足す・
 * 直す PR は毎日のようにあり、そのたびにこの写しの書き直しを求めると、スポットの PR が落ちる。写しが古くても
 * 「新しいスポットでまだ部品が届かない」だけで、間違って届くことは無い（`gen-badge-ledger.ts` の写しと同じ考え）。
 * 写しを直すときは `npx tsx scripts/gen-camper-spots.ts`。**落とすのは写しそのものが壊れているときだけ**
 */
describe("とおまわり号のスポットの写し", () => {
    const rows = JSON.parse(readFileSync(resolve(__dirname, "../../content/spots.json"), "utf8")) as { spotId?: string }[];

    it("写しの形が正しい（区分の並び・空でない）", () => {
        expect(COPY.classes).toEqual([...CAMPER_SPOT_CLASSES]);
        expect(COPY.spots.length).toBeGreaterThan(100);
    });

    it("台帳から作り直したものと違えば警告する（落とさない）", () => {
        const fresh = buildCamperSpots(rows);
        if (JSON.stringify(fresh) !== JSON.stringify(COPY)) {
            console.warn("[camper-spots] 写しが台帳より古い。npx tsx scripts/gen-camper-spots.ts で書き直せます");
        }
        const missing = Object.values(CURATED).flatMap((m) => Object.keys(m)).filter((id) => !rows.some((r) => r.spotId === id));
        if (missing.length) console.warn(`[camper-spots] 人が選んだ一覧の id が台帳に無い: ${missing.join(", ")}`);
        // 書いた日（2026-10-18）の台帳とは一致していた。違っても落とさない
        expect(fresh.classes).toEqual(COPY.classes);
    });
});
