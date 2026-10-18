import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCamperSpots, CURATED } from "../gen-camper-spots";
import COPY from "../../api-user/src/data/camperSpots.json";

/**
 * とおまわり号のスポットの写し（`api-user/src/data/camperSpots.json`）が台帳と食い違っていないか。
 * 台帳（`content/spots.json`）や人が選んだ一覧を直したら `npx tsx scripts/gen-camper-spots.ts` で書き直す
 */
describe("とおまわり号のスポットの写し", () => {
    const rows = JSON.parse(readFileSync(resolve(__dirname, "../../content/spots.json"), "utf8")) as { spotId?: string }[];

    it("写しは台帳から作り直したものと同じ", () => {
        expect(buildCamperSpots(rows), "台帳が変わった。npx tsx scripts/gen-camper-spots.ts で写しを書き直す").toEqual(COPY);
    });

    it("人が選んだ一覧の id は全部台帳に在る（打ち間違い・消えたスポットを残さない）", () => {
        const ids = new Set(rows.map((r) => r.spotId));
        const missing = Object.values(CURATED).flatMap((m) => Object.keys(m)).filter((id) => !ids.has(id));
        expect(missing).toEqual([]);
    });
});
