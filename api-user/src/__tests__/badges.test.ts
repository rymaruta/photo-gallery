import { describe, it, expect } from "vitest";
import {
    BADGE_THRESHOLDS, tierFor, nextThreshold, countBadges, mergeBadges, badgeProgress,
    prefectureOfText, nearestPrefecture, prefectureOfPhoto, countryOfText, seasonOf, yearMonthOf,
    lightOf, shotInstant, wallClockToInstant, sunriseSunset, countBooks, countWish, isCountablePhoto,
    PREFECTURE_NAMES, timeZoneOfPhoto,
} from "../badges";
import { COUNTED_BADGE_KEYS } from "../badgeKeys";
import type { Photo } from "../types";

let seq = 0;
const photo = (over: Partial<Photo> & Record<string, unknown> = {}): Photo =>
    ({ id: `p${++seq}`, src: "https://example.com/a.jpg", userId: "u1", ...over }) as Photo;
const pref = (name: string) => PREFECTURE_NAMES.indexOf(name);

// 台帳に実在するスポット（`content/spots.json`）。網走の流氷（北海道）
const ABASHIRI = { spotId: "sp_391f85dded70", slug: "abashiri-ryuhyo" };

describe("段の線", () => {
    it("線ちょうどで上がり、1つ手前では上がらない", () => {
        for (const key of COUNTED_BADGE_KEYS) {
            const lines = BADGE_THRESHOLDS[key];
            lines.forEach((line, i) => {
                expect(tierFor(key, line - 1), `${key} ${line - 1}`).toBe(i);
                expect(tierFor(key, line), `${key} ${line}`).toBe(i + 1);
            });
            expect(tierFor(key, 0)).toBe(0);
            expect(tierFor(key, 1_000_000)).toBe(lines.length);
        }
    });

    it("決めた線のとおり（owner の決定）", () => {
        expect(BADGE_THRESHOLDS).toEqual({
            first: [1], prefectures: [10, 30, 47], countries: [3, 10, 30], seasons: [1, 2, 3],
            morning: [10, 50, 200], night: [10, 50, 200], books: [3, 10, 30], wish: [3, 10, 30],
        });
    });

    it("次の線。最上段なら null", () => {
        expect(nextThreshold("prefectures", 0)).toBe(10);
        expect(nextThreshold("prefectures", 10)).toBe(30);
        expect(nextThreshold("prefectures", 47)).toBeNull();
        expect(nextThreshold("first", 0)).toBe(1);
        expect(nextThreshold("first", 5)).toBeNull();
    });
});

describe("数えてよい写真", () => {
    it("下書き・ストーリー・実体の無い行は数えない", () => {
        expect(isCountablePhoto(photo())).toBe(true);
        expect(isCountablePhoto(photo({ published: false }))).toBe(false);
        expect(isCountablePhoto(photo({ story: true }))).toBe(false);
        expect(isCountablePhoto(photo({ src: "" }))).toBe(false);
        expect(countBadges([photo({ published: false }), photo({ story: true })], []).first).toBe(0);
        expect(countBadges([photo()], []).first).toBe(1);
    });
});

describe("都道府県", () => {
    // 県の表・日の出の式が Web と同じことは `scripts/__tests__/badgeParity.test.ts` が見る
    // （ここから `lib/` を import すると api-user の型検査の rootDir を越える）

    it("撮影地の文字: 正式名・短い名・英語", () => {
        expect(prefectureOfText("香川県 観音寺市 高屋神社")).toBe(pref("香川県"));
        expect(prefectureOfText("大阪")).toBe(pref("大阪府"));
        expect(prefectureOfText("北海道")).toBe(pref("北海道"));
        expect(prefectureOfText("Kyoto, Japan")).toBe(pref("京都府"));
        expect(prefectureOfText("TOKYO")).toBe(pref("東京都"));
        expect(prefectureOfText("茨城県 ひたちなか市 国営ひたち海浜公園")).toBe(pref("茨城県"));
    });

    it("「東京都」を京都と読まない", () => {
        expect(prefectureOfText("東京都渋谷区")).toBe(pref("東京都"));
        expect(prefectureOfText("東京")).toBe(pref("東京都"));
        expect(prefectureOfText("東京駅")).toBe(pref("東京都"));
        expect(prefectureOfText("京都 嵐山")).toBe(pref("京都府"));
    });

    it("いちばん前に書かれた県を採る", () => {
        expect(prefectureOfText("長野 → 岐阜")).toBe(pref("長野県"));
    });

    it("英語は単語として（premier に mie を当てない）", () => {
        expect(prefectureOfText("premier")).toBeNull();
        expect(prefectureOfText("Mie")).toBe(pref("三重県"));
    });

    it("県名の無い地名は当てない（山中湖・パリ）", () => {
        expect(prefectureOfText("山中湖")).toBeNull();
        expect(prefectureOfText("パリ")).toBeNull();
        expect(prefectureOfText("")).toBeNull();
        expect(prefectureOfText(undefined)).toBeNull();
    });

    it("座標はいちばん近い台帳のスポットの県（日本の外・遠すぎるときは null）", () => {
        expect(nearestPrefecture(35.68, 139.76)).toBe(pref("東京都"));     // 東京駅
        expect(nearestPrefecture(43.06, 141.35)).toBe(pref("北海道"));     // 札幌
        expect(nearestPrefecture(26.21, 127.68)).toBe(pref("沖縄県"));     // 那覇
        expect(nearestPrefecture(34.99, 135.76)).toBe(pref("京都府"));     // 京都駅
        expect(nearestPrefecture(48.86, 2.35)).toBeNull();                 // パリ
        expect(nearestPrefecture(30.0, 150.0)).toBeNull();                 // 枠の中だが海の上
        expect(nearestPrefecture(Number.NaN, 139)).toBeNull();
    });

    it("写真の県: スポット → 撮影地の文字 → 座標 の順", () => {
        expect(prefectureOfPhoto(photo({ spotId: ABASHIRI.spotId, location: "東京" }))).toBe(pref("北海道"));
        expect(prefectureOfPhoto(photo({ location: "大阪", coords: { lat: 43.06, lng: 141.35 } }))).toBe(pref("大阪府"));
        expect(prefectureOfPhoto(photo({ location: "山中湖", coords: { lat: 35.42, lng: 138.87 } }))).toBe(pref("山梨県"));
        expect(prefectureOfPhoto(photo({ location: "山中湖" }))).toBeNull();
    });

    it("10県で銅", () => {
        const names = ["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬"];
        const photos = names.map((n) => photo({ location: n }));
        expect(countBadges(photos.slice(0, 9), []).prefectures).toBe(9);
        expect(countBadges(photos, []).prefectures).toBe(10);
        // 同じ県を何枚撮っても1
        expect(countBadges([...photos, photo({ location: "北海道 富良野" })], []).prefectures).toBe(10);
    });
});

describe("国（iOS の VisitedCountries と同じ）", () => {
    it("書かれている国だけ。地名から当てない", () => {
        expect(countryOfText("パリ, フランス")).toBe("フランス");
        expect(countryOfText("Reykjavik, Iceland")).toBe("アイスランド");
        expect(countryOfText("パリ")).toBeNull();
        expect(countryOfText("ケープタウン 南アフリカ")).toBe("南アフリカ");
    });

    it("3か国で銅（同じ国は1）", () => {
        const photos = ["パリ, フランス", "フランス ヴェルサイユ", "バルセロナ スペイン", "日本"].map((l) => photo({ location: l }));
        expect(countBadges(photos, []).countries).toBe(3);
        expect(tierFor("countries", countBadges(photos, []).countries)).toBe(1);
    });
});

describe("季節", () => {
    it("北半球: 3〜5 春・6〜8 夏・9〜11 秋・12〜2 冬", () => {
        expect([3, 4, 5].map((m) => seasonOf(m, false))).toEqual([0, 0, 0]);
        expect([6, 7, 8].map((m) => seasonOf(m, false))).toEqual([1, 1, 1]);
        expect([9, 10, 11].map((m) => seasonOf(m, false))).toEqual([2, 2, 2]);
        expect([12, 1, 2].map((m) => seasonOf(m, false))).toEqual([3, 3, 3]);
    });

    it("南半球は入れ替える（1月は夏）", () => {
        expect(seasonOf(1, true)).toBe(1);
        expect(seasonOf(7, true)).toBe(3);
    });

    it("撮影日 → EXIF の順で年月を読む", () => {
        expect(yearMonthOf(photo({ date: "2024-10-12" }))).toEqual({ y: 2024, m: 10 });
        expect(yearMonthOf(photo({ exif: { dateTimeOriginal: "2023:06:21 05:00:00" } }))).toEqual({ y: 2023, m: 6 });
        expect(yearMonthOf(photo())).toBeNull();
    });

    it("4つ揃った年だけ数える", () => {
        const y2024 = ["2024-01-05", "2024-04-05", "2024-07-05", "2024-10-05"].map((d) => photo({ date: d }));
        const y2025 = ["2025-01-05", "2025-04-05", "2025-07-05"].map((d) => photo({ date: d }));
        expect(countBadges([...y2024, ...y2025], []).seasons).toBe(1);
        expect(countBadges([...y2024, ...y2025, photo({ date: "2025-12-24" })], []).seasons).toBe(1);   // 冬を足しても秋が無い
        expect(countBadges([...y2024, ...y2025, photo({ date: "2025-10-24" })], []).seasons).toBe(2);
    });

    it("南半球の写真は季節を入れ替えて数える", () => {
        const syd = { lat: -33.87, lng: 151.21 };
        // 南半球の 1月=夏・4月=秋・7月=冬・10月=春
        const photos = ["2024-01-05", "2024-04-05", "2024-07-05", "2024-10-05"].map((d) => photo({ date: d, coords: syd }));
        expect(countBadges(photos, []).seasons).toBe(1);
        // 北の夏（7月）と南の冬（7月）を混ぜると、夏が2回で冬が無い
        const mixed = [
            photo({ date: "2024-04-05" }), photo({ date: "2024-07-05" }), photo({ date: "2024-10-05" }),
            photo({ date: "2024-01-05", coords: syd }),   // 南の1月＝夏
        ];
        expect(countBadges(mixed, []).seasons).toBe(0);
    });
});

describe("光（日の出・日の入り）", () => {
    // 東京・2024-06-21: 日の出 4:25・日の入り 19:00（JST・国立天文台の暦とおおむね同じ）
    const tokyo = { coords: { lat: 35.68, lng: 139.76 }, location: "東京" };
    const at = (dt: string, extra: Record<string, unknown> = tokyo) => photo({ ...extra, exif: { dateTimeOriginal: dt } });

    it("白夜・極夜は時刻が無い", () => {
        expect(sunriseSunset(2024, 6, 21, 69.65, 18.96)).toBeNull();   // トロムソの夏至
    });

    it("日の出の前後1時間は朝", () => {
        expect(lightOf(at("2024-06-21T04:30:00"))).toBe("morning");
        expect(lightOf(at("2024-06-21T03:30:00"))).toBe("morning");   // 出の55分前
        expect(lightOf(at("2024-06-21T05:20:00"))).toBe("morning");
        expect(lightOf(at("2024-06-21T05:40:00"))).toBeNull();        // 出の1時間15分後
        expect(lightOf(at("2024-06-21T12:00:00"))).toBeNull();
    });

    it("日の入りから翌日の日の出の1時間前までは夜", () => {
        expect(lightOf(at("2024-06-21T18:50:00"))).toBeNull();         // 入りの前
        expect(lightOf(at("2024-06-21T19:10:00"))).toBe("night");
        expect(lightOf(at("2024-06-21T23:59:00"))).toBe("night");
        expect(lightOf(at("2024-06-22T02:00:00"))).toBe("night");
        expect(lightOf(at("2024-06-22T03:15:00"))).toBe("night");       // 次の出の1時間10分前
    });

    it("ゾーンが書いてあれば、それで瞬間にする", () => {
        // 2024-06-20T19:30Z ＝ JST 6/21 4:30
        expect(shotInstant(at("2024-06-20T19:30:00Z"))).toBe(Date.UTC(2024, 5, 20, 19, 30));
        expect(lightOf(at("2024-06-21T04:30:00+09:00"))).toBe("morning");
        expect(lightOf(at("2024-06-20T19:30:00Z", { coords: tokyo.coords }))).toBe("morning");
    });

    it("座標・撮影時刻が無い写真は数えない", () => {
        expect(lightOf(photo({ location: "東京", exif: { dateTimeOriginal: "2024-06-21T04:30:00" } }))).toBeNull();
        expect(lightOf(photo({ ...tokyo, date: "2024-06-21" }))).toBeNull();        // 日付だけ
    });

    it("時刻帯を決められない壁時計は数えない（パリの座標だけ・撮影地なし）", () => {
        expect(lightOf(at("2024-06-21T05:50:00", { coords: { lat: 48.86, lng: 2.35 } }))).toBeNull();
        // 撮影地に国が書いてあれば、その国の時刻帯（夏時間込み）で直す。パリの出は 5:47
        expect(lightOf(at("2024-06-21T05:50:00", { coords: { lat: 48.86, lng: 2.35 }, location: "パリ, フランス" }))).toBe("morning");
        // 時刻帯が複数ある国（アメリカ）は決めない
        expect(timeZoneOfPhoto(photo({ location: "ニューヨーク アメリカ" }))).toBeNull();
    });

    it("撮影日（date）に時刻が入っていれば、それも読む", () => {
        expect(lightOf(photo({ ...tokyo, date: "2024-06-21T19:30:00" }))).toBe("night");
    });

    it("南半球（シドニー 1月・出 5:50 頃 AEDT）", () => {
        const syd = { coords: { lat: -33.87, lng: 151.21 }, location: "シドニー オーストラリア" };
        // オーストラリアは時刻帯が複数あるので表に無い → スポット・県が無ければ決めない
        expect(lightOf(at("2024-01-10T05:50:00", syd))).toBeNull();
        expect(lightOf(at("2024-01-09T18:50:00Z", { coords: syd.coords }))).toBe("morning");
    });

    it("壁時計 → 瞬間（夏時間の前後）", () => {
        expect(wallClockToInstant(Date.UTC(2024, 0, 15, 12), "Europe/Paris")).toBe(Date.UTC(2024, 0, 15, 11));
        expect(wallClockToInstant(Date.UTC(2024, 6, 15, 12), "Europe/Paris")).toBe(Date.UTC(2024, 6, 15, 10));
        expect(wallClockToInstant(Date.UTC(2024, 6, 15, 12), "Asia/Tokyo")).toBe(Date.UTC(2024, 6, 15, 3));
        expect(wallClockToInstant(Date.UTC(2024, 6, 15, 12), "Not/AZone")).toBeNull();
    });

    it("10枚で朝の銅", () => {
        const mornings = Array.from({ length: 10 }, (_, i) => at(`2024-06-${String(i + 1).padStart(2, "0")}T04:30:00`));
        const counts = countBadges(mornings, []);
        expect(counts.morning).toBe(10);
        expect(counts.night).toBe(0);
        expect(tierFor("morning", counts.morning)).toBe(1);
    });
});

describe("旅の一冊（iOS の TripBook.groupTrips と同じ規則）", () => {
    const book = (g: string, ...dates: (string | undefined)[]) => dates.map((d) => photo({ groupId: g, date: d }));

    it("trip- の束・撮影日のある2枚以上・30日以内だけ1冊", () => {
        expect(countBooks(book("trip-a", "2024-05-01", "2024-05-03"))).toBe(1);
        expect(countBooks(book("trip-b", "2024-05-01"))).toBe(0);                          // 1枚
        expect(countBooks(book("trip-c", "2024-05-01", "2024-06-15"))).toBe(0);            // 45日
        expect(countBooks(book("trip-d", "2024-05-01", "2024-05-31"))).toBe(1);            // ちょうど30日
        expect(countBooks(book("plain-group", "2024-05-01", "2024-05-02"))).toBe(0);       // 旅の束でない
        expect(countBooks(book("trip-e", "2024-05-01", undefined, "2024-02-30"))).toBe(0); // 撮影日のある1枚だけ
        expect(countBooks(book(" trip-f ", "2024-05-01", "2024-05-02"))).toBe(1);          // 前後の空白は落とす
    });

    it("3冊で銅", () => {
        const photos = [
            ...book("trip-1", "2024-01-01", "2024-01-02"),
            ...book("trip-2", "2024-02-01", "2024-02-02"),
            ...book("trip-3", "2024-03-01", "2024-03-02"),
        ];
        expect(countBadges(photos, []).books).toBe(3);
        // 下書きの写真は数えない（公開している写真だけ）
        photos[5] = { ...photos[5], published: false };
        expect(countBadges(photos, []).books).toBe(2);
    });
});

describe("行けた場所", () => {
    it("SPOT-<スラッグ> を台帳で spotId に結び、その spotId の写真があれば1", () => {
        const photos = [photo({ spotId: ABASHIRI.spotId })];
        expect(countWish(photos, [`SPOT-${ABASHIRI.slug}`])).toBe(1);
        expect(countWish(photos, [ABASHIRI.slug])).toBe(0);                // 撮影地のスラッグ（台帳のスポットではない）
        expect(countWish(photos, ["SPOT-no-such-spot"])).toBe(0);
        expect(countWish([], [`SPOT-${ABASHIRI.slug}`])).toBe(0);
        // 同じスポットを何枚撮っても1
        expect(countWish([...photos, photo({ spotId: ABASHIRI.spotId })], [`SPOT-${ABASHIRI.slug}`])).toBe(1);
    });
});

describe("保存済みに重ねる", () => {
    const AT0 = "2026-01-01T00:00:00.000Z";
    const NOW = "2026-10-09T00:00:00.000Z";
    const counts = (over: Partial<Record<string, number>>) =>
        ({ first: 0, prefectures: 0, countries: 0, seasons: 0, morning: 0, night: 0, books: 0, wish: 0, ...over }) as Parameters<typeof mergeBadges>[1];

    it("上がった段だけ at を今にし、通知に回す", () => {
        const r = mergeBadges({ first: { tier: 1, at: AT0 } }, counts({ first: 3, morning: 50 }), NOW);
        expect(r.badges).toEqual({ first: { tier: 1, at: AT0 }, morning: { tier: 2, at: NOW } });
        expect(r.upgraded).toEqual([{ key: "morning", tier: 2 }]);
    });

    it("段は下げない（写真を消しても残る）", () => {
        const r = mergeBadges({ prefectures: { tier: 2, at: AT0 } }, counts({ prefectures: 3 }), NOW);
        expect(r.badges.prefectures).toEqual({ tier: 2, at: AT0 });
        expect(r.upgraded).toEqual([]);
    });

    it("数えないメダル（earlyUser）はそのまま残る", () => {
        const r = mergeBadges({ earlyUser: { tier: 1, at: AT0 } }, counts({}), NOW);
        expect(r.badges).toEqual({ earlyUser: { tier: 1, at: AT0 } });
    });

    it("進み具合: 持っている段・次の線・earlyUser", () => {
        const p = badgeProgress(counts({ prefectures: 12, first: 1 }), { earlyUser: { tier: 1, at: AT0 }, morning: { tier: 1, at: AT0 } });
        expect(p.prefectures).toEqual({ count: 12, tier: 1, next: 30 });
        expect(p.first).toEqual({ count: 1, tier: 1, next: null });
        // 写真が減って数が線を割っても、持っている段は下げない
        expect(p.morning).toEqual({ count: 0, tier: 1, next: 10 });
        expect(p.earlyUser).toEqual({ count: 1, tier: 1, next: null });
        expect(badgeProgress(counts({}), undefined).earlyUser).toEqual({ count: 0, tier: 0, next: null });
    });
});
