import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PROD48 from "../../lib/utils/__tests__/spotAutoLink.prod48.json";

/**
 * **iOS が読む「写真 → 撮影スポット」の表**（`/app/data/spot-photo-links.json`・2026-10-31・journey.photo-ios#425）。
 *
 * 置き場と形を固定する（iOS の担当はこの形で読む）:
 *   - 置き場: `out/app/data/spot-photo-links.json`（`spot-feed/` の隣・route が force-static）
 *   - 形: `{"v":1,"links":{"<写真 id>":"<撮影スポット id>"}}`。鍵はこの2つだけ
 *   - 入るのは自動の結びだけ（`spotId` を持つ・外した・非公開の写真は入らない）
 * 投稿画面が読む索引（`/app/data/spot-match.json`）も同じ形で建つことを見る。
 */
const photos = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../lib/server/photos", () => ({ loadAllPhotos: async () => photos.list }));

const linksRoute = await import("../app/data/spot-photo-links.json/route");
const matchRoute = await import("../app/data/spot-match.json/route");

describe("spot-photo-links.json", () => {
    it("spot-feed/ の隣に静的に建つ", () => {
        const dir = path.join(process.cwd(), "app", "app", "data");
        expect(fs.existsSync(path.join(dir, "spot-feed"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "spot-photo-links.json", "route.ts"))).toBe(true);
        expect(linksRoute.dynamic).toBe("force-static");
    });

    it("形は {v:1, links:{写真 id: 撮影スポット id}}。本番の 48枚で 16件", async () => {
        photos.list = PROD48;
        const res = await linksRoute.GET();
        expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
        const body = await res.json() as { v: number; links: Record<string, string> };
        expect(Object.keys(body).sort()).toEqual(["links", "v"]);
        expect(body.v).toBe(1);
        expect(Object.keys(body.links)).toHaveLength(16);
        for (const [photo, spot] of Object.entries(body.links)) {
            expect(typeof photo).toBe("string");
            expect(spot).toMatch(/^sp_[0-9a-f]{12}$/);
        }
    });

    it("spotId を持つ・外した・非公開の写真は入れない", async () => {
        const fox = PROD48.find((p) => p.id === "ec059fb7-7727-516a-bfb6-fd64835d89ad")!;
        photos.list = [
            { ...fox, id: "own", spotId: "sp_aaaaaaaaaaaa" },
            { ...fox, id: "off", spotAuto: "off" },
            { ...fox, id: "hidden", published: false },
            { ...fox, id: "auto" },
        ];
        const body = await (await linksRoute.GET()).json() as { links: Record<string, string> };
        expect(Object.keys(body.links)).toEqual(["auto"]);
    });
});

describe("spot-match.json", () => {
    it("投稿画面が読む索引が静的に建つ（v:1・公開済みの行）", async () => {
        expect(matchRoute.dynamic).toBe("force-static");
        const body = await matchRoute.GET().json() as { v: number; spots: unknown[] };
        expect(body.v).toBe(1);
        expect(body.spots.length).toBeGreaterThan(1000);
    });
});
