import { describe, it, expect } from "vitest";
import {
    photoLightZone, addDays, nextGoldenHour, goldenLineParts,
    directionsUrl, directionsTarget, inspiredUploadHref, offersInspiredShoot,
} from "../photoTrip";

/**
 * 写真の詳細の「NEXT TRIP · 次の旅へ」の判断（アプリの `PhotoTrip` と同じ考え）。
 * 時刻の値は `sunTimes.test.ts` の銀山温泉（国立天文台の暦と照らした値）を使う。
 */
const GINZAN = { lat: 38.58, lng: 140.53 };
const TROMSO = { lat: 69.65, lng: 18.96 };

describe("photoLightZone（光の時刻を言う時計・台帳のスポットだけ）", () => {
    it("台帳のスポットの座標と時刻帯が引ければ、その時刻帯", () => {
        expect(photoLightZone(GINZAN, "Asia/Tokyo")).toBe("Asia/Tokyo");
        expect(photoLightZone({ lat: -18.14, lng: 178.44 }, "Pacific/Fiji")).toBe("Pacific/Fiji");
    });
    it("スポットの時刻帯が無ければ出さない（写真の座標が日本の中でも推測しない）", () => {
        expect(photoLightZone({ lat: 35.68, lng: 139.69 }, null)).toBeNull();
        expect(photoLightZone({ lat: 35.68, lng: 139.69 }, "")).toBeNull();
    });
    it("スポットに座標が無ければ出さない（写真の座標で計算するとスポットの時計と場所が食い違う）", () => {
        expect(photoLightZone(null, "Asia/Tokyo")).toBeNull();
        expect(photoLightZone(undefined, "Asia/Tokyo")).toBeNull();
        expect(photoLightZone({ lat: NaN, lng: 139 }, "Asia/Tokyo")).toBeNull();
    });
});

describe("addDays", () => {
    it("月・年をまたぐ", () => {
        expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
        expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    });
    it("読めない日付は null", () => {
        expect(addDays("2026/10/10", 1)).toBeNull();
    });
});

describe("nextGoldenHour（次のゴールデンアワー）", () => {
    it("昼なら、今日の夕方のゴールデンアワー", () => {
        const g = nextGoldenHour(GINZAN, "Asia/Tokyo", new Date("2026-10-10T12:00:00+09:00"), "Asia/Tokyo");
        expect(g).toEqual({ day: "today", start: "16:34", end: "17:26", local: false });
    });

    it("ゴールデンアワーの最中なら、それを今日として出す", () => {
        const g = nextGoldenHour(GINZAN, "Asia/Tokyo", new Date("2026-10-10T17:00:00+09:00"), "Asia/Tokyo");
        expect(g?.day).toBe("today");
        expect(g?.start).toBe("16:34");
    });

    it("夕方が終わっていたら、明日の朝", () => {
        const g = nextGoldenHour(GINZAN, "Asia/Tokyo", new Date("2026-10-10T18:00:00+09:00"), "Asia/Tokyo")!;
        expect(g.day).toBe("tomorrow");
        expect(g.start < "07:00", `朝ではない: ${g.start}`).toBe(true);
    });

    it("端末の時計がその土地と違えば local（「（現地）」を添える）", () => {
        const g = nextGoldenHour(GINZAN, "Asia/Tokyo", new Date("2026-10-10T12:00:00+09:00"), "Europe/Paris");
        expect(g?.local).toBe(true);
        expect(g?.start, "時刻はその土地の時計で言う").toBe("16:34");
    });

    it("白夜で太陽がその高さを通らない日々は null（作り話の時刻を出さない）", () => {
        expect(nextGoldenHour(TROMSO, "Europe/Oslo", new Date("2026-06-21T12:00:00+02:00"), "Europe/Oslo")).toBeNull();
    });

    it("時計か座標が無ければ null", () => {
        expect(nextGoldenHour(GINZAN, null, new Date())).toBeNull();
        expect(nextGoldenHour(null, "Asia/Tokyo", new Date())).toBeNull();
    });
});

describe("goldenLineParts（板の1行）", () => {
    it("「次のゴールデンアワー · 明日」と時刻", () => {
        expect(goldenLineParts({ day: "tomorrow", start: "16:12", end: "16:48", local: false }, true))
            .toEqual({ label: "次のゴールデンアワー · 明日", time: "16:12–16:48" });
    });
    it("時計が違う土地は「（現地）」", () => {
        expect(goldenLineParts({ day: "today", start: "06:01", end: "06:40", local: true }, true).time)
            .toBe("06:01–06:40（現地）");
    });
});

describe("経路", () => {
    it("Google マップの経路の画面（行き先だけ渡す）", () => {
        expect(directionsUrl({ lat: 36.5621, lng: 136.6625 }))
            .toBe("https://www.google.com/maps/dir/?api=1&destination=36.5621,136.6625");
    });
    it("座標が無い・数でないなら null", () => {
        expect(directionsUrl(null)).toBeNull();
        expect(directionsUrl({ lat: NaN, lng: 1 })).toBeNull();
    });
    it("行き先は台帳のスポットの座標が先", () => {
        expect(directionsTarget({ coords: { lat: 1, lng: 2 } }, { lat: 3, lng: 4 })).toEqual({ lat: 3, lng: 4 });
    });
    it("スポットが無ければ写真の正確な座標", () => {
        expect(directionsTarget({ coords: { lat: 1, lng: 2 } }, null)).toEqual({ lat: 1, lng: 2 });
    });
    it("おおよその座標には経路を出さない", () => {
        expect(directionsTarget({ coords: { lat: 1, lng: 2 }, geoApprox: true }, null)).toBeNull();
    });
});

describe("この写真を見て撮りに行く", () => {
    it("投稿画面に元の写真の id を渡す（符号化する）", () => {
        expect(inspiredUploadHref("abc")).toBe("/user/upload?inspiredBy=abc");
        expect(inspiredUploadHref("a b&c")).toBe("/user/upload?inspiredBy=a%20b%26c");
    });
    it("公開の他人の写真に出す", () => {
        expect(offersInspiredShoot({ id: "p", userId: "alice" }, "bob")).toBe(true);
        expect(offersInspiredShoot({ id: "p", userId: "alice" }, null)).toBe(true);
    });
    it("自分の写真・非公開の写真には出さない", () => {
        expect(offersInspiredShoot({ id: "p", userId: "alice" }, "alice")).toBe(false);
        expect(offersInspiredShoot({ id: "p", userId: "alice", published: false }, "bob")).toBe(false);
        expect(offersInspiredShoot(null, "bob")).toBe(false);
    });

    it("公開範囲を絞った写真には出さない（空か everyone だけ・サーバーが元の写真として付けない）", () => {
        expect(offersInspiredShoot({ id: "p", userId: "alice", audience: "everyone" }, "bob")).toBe(true);
        expect(offersInspiredShoot({ id: "p", userId: "alice", audience: "" }, "bob")).toBe(true);
        expect(offersInspiredShoot({ id: "p", userId: "alice", audience: "followers" }, "bob")).toBe(false);
        expect(offersInspiredShoot({ id: "p", userId: "alice", audience: "closeFriends" }, null)).toBe(false);
    });
});
