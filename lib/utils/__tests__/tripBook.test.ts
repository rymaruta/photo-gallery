import { describe, it, expect, vi } from "vitest";
import {
    trips, shelfTrips, groupTrips, coverOf, tripDays, mainPlace, dateRange, monthDay, daysLabel, tripTitle,
    placeCount, tripDistanceKm, distanceText, daysOf, routeStops, sampledStops, shareText, dayOf, inOrder,
    ymdToDay, profileTripPhotos, isPublicPhoto, hasTakenDay, findTrip, tripBookPath, tripLine, type TripPhoto, type RouteStop,
} from "../tripBook";

/**
 * 旅の一冊の決まり。**iOS の `TripBookTests.swift`・`TripBookGroupsTests.swift` と同じ場面を、
 * 同じ答えで**見張る（アプリと Web で同じ写真が別の旅に割れないように）。
 * 各 `it` の名前の後ろの括弧は、対応する iOS の試験の名前。
 */

const photo = (id: string, o: Partial<TripPhoto> & { user?: string | null } = {}): TripPhoto => {
    const { user = "owner", ...rest } = o;
    return { id, src: `https://x/${id}.jpg`, ...(user ? { userId: user } : {}), ...rest } as TripPhoto;
};
const day = (ymd: string) => ymdToDay(ymd)!;
const ids = (list: { id: string }[] | undefined) => (list ?? []).map((p) => p.id);
const UTC = "UTC";
const TOKYO = "Asia/Tokyo";

describe("旅にまとめる（TripBookTests）", () => {
    it("連続した日は1つの旅・古い順（testConsecutiveDaysBecomeOneTrip）", () => {
        const t = trips([photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-02" }), photo("c", { date: "2026-05-03" })]);
        expect(t).toHaveLength(1);
        expect(ids(t[0].photos)).toEqual(["a", "b", "c"]);
        expect(tripDays(t[0])).toBe(3);
    });

    it("3日空いても同じ旅（testAGapOfThreeDaysStillOneTrip）", () => {
        expect(trips([photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-04" })])).toHaveLength(1);
    });

    it("4日空いたら別の旅（3日の境目）", () => {
        expect(trips([photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-05" })])).toHaveLength(0);
    });

    it("離れすぎていれば別の旅・新しい旅が先頭（testAWeekApartIsAnotherTrip）", () => {
        const t = trips([
            photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-02" }),
            photo("c", { date: "2026-05-20" }), photo("d", { date: "2026-05-21" }),
        ]);
        expect(t).toHaveLength(2);
        expect(ids(t[0].photos)).toEqual(["c", "d"]);
    });

    it("1枚は旅ではない（testASinglePhotoIsNotATrip）", () => {
        expect(trips([photo("a", { date: "2026-05-01" })])).toEqual([]);
    });

    it("場所では切らない・いちばん多い撮影地が題（testDifferentPlacesInTheSameDaysStayOneTrip）", () => {
        const t = trips([
            photo("a", { date: "2026-05-01", location: "金沢" }),
            photo("b", { date: "2026-05-02", location: "金沢" }),
            photo("c", { date: "2026-05-03", location: "福井" }),
        ]);
        expect(t).toHaveLength(1);
        expect(t[0].place).toBe("金沢");
    });

    it("同数なら先に出てきた撮影地が題", () => {
        expect(mainPlace([{ location: "パリ" }, { location: "バルセロナ" }])).toBe("パリ");
        expect(mainPlace([{ location: " " }, {}])).toBe("");
    });

    it("日付を持たない写真は混ぜない（testUndatedPhotosAreLeftOut）", () => {
        const t = trips([photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-02" }), photo("none")]);
        expect(ids(t[0].photos)).toEqual(["a", "b"]);
    });

    it("表紙はいいねがいちばん多い1枚・同じなら最初（testCoverIsTheMostLikedPhoto）", () => {
        const t = trips([photo("a", { date: "2026-05-01", likes: 1 }), photo("b", { date: "2026-05-02", likes: 9 })]);
        expect(coverOf(t[0])?.id).toBe("b");
        const tie = trips([photo("x", { date: "2026-05-01", likes: 3 }), photo("y", { date: "2026-05-02", likes: 3 })]);
        expect(coverOf(tie[0])?.id).toBe("x");
    });

    it("同じ日だけの旅は1日（testSameDayTripIsOneDay）", () => {
        const t = trips([photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-01" })]);
        expect(tripDays(t[0])).toBe(1);
    });

    it("🔴 撮影日の無い写真は旅に入れない（testPhotosWithoutTakenDayAreNotATrip）", () => {
        const bulk = ["paris", "hokkaido", "kagawa"].map((id, i) => photo(id, { createdAt: `2026-01-20T01:0${i}:00.000Z` }));
        expect(trips(bulk, TOKYO)).toEqual([]);
    });

    it("暦の上に無い撮影日は撮影日として読まない", () => {
        expect(trips([photo("a", { date: "2026-02-30" }), photo("b", { date: "2026-02-28" })])).toEqual([]);
    });
});

describe("旅は1人のもの（TripOwnershipTests）", () => {
    it("別の人の写真が1つの旅に混ざらない", () => {
        const t = trips([
            photo("a1", { user: "A", date: "2026-05-01" }), photo("b1", { user: "B", date: "2026-05-01" }),
            photo("a2", { user: "A", date: "2026-05-02" }), photo("b2", { user: "B", date: "2026-05-02" }),
        ]);
        expect(t).toHaveLength(2);
        for (const trip of t) expect(new Set(trip.photos.map((p) => p.userId)).size).toBe(1);
    });

    it("投稿者が分からない写真どうしを束ねない", () => {
        expect(trips([photo("x", { user: null, date: "2026-05-01" }), photo("y", { user: null, date: "2026-05-02" })])).toEqual([]);
    });

    it("uploadedBy だけの写真もその人の旅に束ねる", () => {
        const t = trips([
            photo("a1", { user: null, uploadedBy: "A", date: "2026-05-01" }),
            photo("a2", { user: null, uploadedBy: "A", date: "2026-05-02" }),
        ]);
        expect(t).toHaveLength(1);
        expect(t[0].photos).toHaveLength(2);
    });
});

describe("日（TripBookFactsTests）", () => {
    it("投稿日時は渡した時刻帯の暦日（東京の朝は UTC では前の日）", () => {
        expect(dayOf(photo("m", { createdAt: "2026-05-01T22:00:00.000Z" }), TOKYO)).toBe(day("2026-05-02"));
        expect(dayOf(photo("e", { createdAt: "2026-05-02T10:00:00.000Z" }), TOKYO)).toBe(day("2026-05-02"));
    });

    it("ロサンゼルスでも暦の日で数える", () => {
        const LA = "America/Los_Angeles";
        const a = dayOf(photo("a", { createdAt: "2026-05-02T03:00:00.000Z" }), LA)!;
        const b = dayOf(photo("b", { createdAt: "2026-05-03T15:00:00.000Z" }), LA)!;
        expect(a).toBe(day("2026-05-01"));
        expect(b).toBe(day("2026-05-03"));
        expect(b - a).toBe(2);
    });

    it("撮影日（日付だけ）は時刻帯に関係なく書いてある日（testTakenDateIgnoresTheTimeZone）", () => {
        const t = trips([photo("a", { date: "2026-09-12" }), photo("b", { date: "2026-09-14" })], "America/Los_Angeles");
        expect(dateRange(t[0].start, t[0].end)).toBe("2026.09.12 — 09.14");
    });

    it("同じ日の中は投稿の時刻順（日→投稿時刻→元の並び）", () => {
        const list = [
            photo("d", { createdAt: "2026-05-02T20:00:00.000Z" }),
            photo("b", { createdAt: "2026-05-02T03:00:00.000Z" }),
            photo("a", { date: "2026-05-02", createdAt: "2026-05-03T00:00:00.000Z" }),
            photo("c", { date: "2026-05-01" }),
        ];
        expect(ids(inOrder(list, TOKYO))).toEqual(["c", "b", "a", "d"]);
    });
});

describe("文字と数（TripBookFactsTests）", () => {
    it("期間の範囲", () => {
        expect(dateRange(day("2026-09-12"), day("2026-09-14"))).toBe("2026.09.12 — 09.14");
        expect(dateRange(day("2026-09-12"), day("2026-09-12"))).toBe("2026.09.12");
        expect(dateRange(day("2025-12-30"), day("2026-01-02"))).toBe("2025.12.30 — 2026.01.02");
        expect(monthDay(day("2026-09-03"))).toBe("09.03");
    });

    it("題は「金沢の旅」・撮影地が無ければ「旅の記録」", () => {
        const t = trips([photo("a", { date: "2026-09-12", location: "金沢" }), photo("b", { date: "2026-09-13", location: "金沢" })]);
        expect(tripTitle(t[0])).toBe("金沢の旅");
        expect(tripTitle(t[0], false)).toBe("Trip to 金沢");
        expect(tripTitle({ place: "" })).toBe("旅の記録");
        expect(daysLabel(1, false)).toBe("1 day");
        expect(daysLabel(3)).toBe("3日間");
    });

    it("撮影地は名前の異なりで数える（testPlaceCount）", () => {
        expect(placeCount([{ location: "金沢" }, { location: " 金沢 " }, { location: "福井" }, { location: "" }, {}])).toBe(2);
    });

    it("直線距離は座標のある写真だけをつなぐ（testDistanceSkipsPhotosWithoutCoords）", () => {
        const km = tripDistanceKm([
            photo("a", { date: "2026-09-12", coords: { lat: 36.56, lng: 136.65 } }),
            photo("b", { date: "2026-09-13" }),
            photo("c", { date: "2026-09-14", coords: { lat: 36.06, lng: 136.22 } }),
        ], TOKYO)!;
        expect(Math.abs(km - 67)).toBeLessThanOrEqual(3);
    });

    it("数えられないときは「—」・同じ場所の2枚は 0（testDistanceIsUnknownWithFewerThanTwoPoints）", () => {
        expect(tripDistanceKm([photo("a", { date: "2026-09-12", coords: { lat: 36.56, lng: 136.65 } }), photo("b", { date: "2026-09-13" })])).toBeNull();
        expect(distanceText(null)).toBe("—");
        expect(tripDistanceKm([
            photo("a", { date: "2026-09-12", coords: { lat: 36.56, lng: 136.65 } }),
            photo("b", { date: "2026-09-13", coords: { lat: 36.56, lng: 136.65 } }),
        ])).toBe(0);
        expect(distanceText(0)).toBe("0");
        expect(distanceText(12940.4)).toBe("12,940");
    });

    it("撮った日ごとに段・撮っていない日は段を作らない（testDaysGroupPhotosAndSkipEmptyDays）", () => {
        const t = trips([
            photo("a", { date: "2026-09-12", location: "金沢" }), photo("b", { date: "2026-09-12", location: "金沢" }),
            photo("c", { date: "2026-09-14", location: "福井" }),
        ]);
        const days = daysOf(t[0]);
        expect(days.map((d) => d.number)).toEqual([1, 3]);
        expect(days.map((d) => ids(d.photos))).toEqual([["a", "b"], ["c"]]);
        expect(days.map((d) => d.place)).toEqual(["金沢", "福井"]);
        expect(days.map((d) => monthDay(d.day))).toEqual(["09.12", "09.14"]);
    });

    it("共有の文は題と期間（testShareTextHasTitleAndPeriodButNoLink）", () => {
        const t = trips([photo("a", { date: "2026-09-12", location: "金沢" }), photo("b", { date: "2026-09-14", location: "金沢" })]);
        const text = shareText(t[0]);
        expect(text.startsWith("金沢の旅")).toBe(true);
        expect(text).toContain("2026.09.12 — 09.14");
        expect(text).not.toContain("http");
        expect(tripLine(t[0])).toBe("2026.09.12 — 09.14 · 3日間 · 2枚");
    });
});

describe("足取り（TripRouteTests）", () => {
    const tripOf = (list: TripPhoto[]) => trips(list)[0];
    const at = (id: string, place: string | undefined, date = "2026-05-01") => photo(id, { date, location: place });

    it("同じ場所が続いたらまとめる・戻りも1歩", () => {
        expect(routeStops(tripOf([at("a", "金沢"), at("b", "金沢"), at("c", "福井")])).map((s) => s.place)).toEqual(["金沢", "福井"]);
        expect(routeStops(tripOf([at("a", "金沢"), at("b", "福井"), at("c", "金沢")])).map((s) => s.place)).toEqual(["金沢", "福井", "金沢"]);
    });

    it("1か所だけ・撮影地なしでは出さない", () => {
        expect(routeStops(tripOf([at("a", "三条市, 日本"), at("b", "三条市, 日本")]))).toEqual([]);
        expect(routeStops(tripOf([at("a", undefined), at("b", undefined)]))).toEqual([]);
    });

    it("点にはその場所に着いた日（testStopsCarryTheDayTheyWereReached）", () => {
        expect(routeStops(tripOf([at("a", "金沢", "2026-09-12"), at("b", "金沢", "2026-09-13"), at("c", "福井", "2026-09-14")])))
            .toEqual([{ day: 1, place: "金沢" }, { day: 3, place: "福井" }]);
    });

    const stops = (names: string[]): RouteStop[] => names.map((place, i) => ({ day: i + 1, place }));

    it("間引いても最初と最後を残す（testSamplingKeepsTheEnds）", () => {
        const s = sampledStops(stops(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]));
        expect(s).toHaveLength(4);
        expect(s[0].place).toBe("P1");
        expect(s[3].place).toBe("P7");
        expect(sampledStops(stops(["P1", "P2", "P3"]))).toHaveLength(3);
    });

    it("間引いたあとに同じ地名が隣り合わない・点1つなら空・終点は最後の日", () => {
        const places = sampledStops(stops(["A", "B", "A", "B", "C"])).map((s) => s.place);
        for (let i = 1; i < places.length; i++) expect(places[i]).not.toBe(places[i - 1]);
        expect(sampledStops(stops(["A", "B", "A", "B", "A", "B", "A"]))).toEqual([]);
        expect(sampledStops(stops(["X", "Y", "A", "Z", "B", "C", "B"])))
            .toEqual([{ day: 1, place: "X" }, { day: 3, place: "A" }, { day: 7, place: "B" }]);
    });
});

describe("束の一冊（TripBookGroupsTests）", () => {
    it("旅の写真から上げた束は一冊（非公開を含む）", () => {
        const list = [
            photo("a", { date: "2026-09-12", groupId: "trip-g1", published: false, location: "京都市" }),
            photo("b", { date: "2026-09-14", groupId: "trip-g1", published: false, location: "京都市" }),
            photo("c", { date: "2026-09-13", groupId: "trip-g1", published: false, location: "大阪市" }),
        ];
        const shelf = shelfTrips(list, UTC);
        expect(shelf).toHaveLength(1);
        expect(shelf[0].id).toBe("group#trip-g1");
        expect(shelf[0].isPrivate).toBe(true);
        expect(shelf[0].place).toBe("京都市");
        expect(ids(shelf[0].photos)).toEqual(["a", "c", "b"]);
        expect([shelf[0].start, shelf[0].end]).toEqual([day("2026-09-12"), day("2026-09-14")]);
    });

    it("束の写真は日付の束に入らない", () => {
        const shelf = shelfTrips([
            photo("g-a", { date: "2026-09-12", groupId: "trip-g1", published: true }),
            photo("g-b", { date: "2026-09-13", groupId: "trip-g1", published: true }),
            photo("p-a", { date: "2026-09-13" }), photo("p-b", { date: "2026-09-14" }),
        ], UTC);
        expect(shelf).toHaveLength(2);
        const all = shelf.flatMap((t) => ids(t.photos));
        expect(new Set(all).size).toBe(all.length);
    });

    it("1枚の束・30日を超える束は一冊にしない（30日ちょうどは一冊）", () => {
        const one = shelfTrips([photo("g-a", { date: "2026-09-12", groupId: "trip-g1" }), photo("p-a", { date: "2026-09-13" })], UTC);
        expect(one.find((t) => t.groupId)).toBeUndefined();
        expect(ids(one[0].photos)).toEqual(["g-a", "p-a"]);
        const long = shelfTrips(["2026-01-10", "2026-01-11", "2026-02-12", "2026-02-13"].map((d, i) => photo(`x${i}`, { date: d, groupId: "trip-g1" })), UTC);
        expect(long.map((t) => ids(t.photos))).toEqual([["x2", "x3"], ["x0", "x1"]]);
        expect(groupTrips([photo("a", { date: "2026-01-01", groupId: "trip-g2" }), photo("b", { date: "2026-01-31", groupId: "trip-g2" })], UTC)).toHaveLength(1);
        expect(groupTrips([photo("a", { date: "2026-01-01", groupId: "trip-g2" }), photo("b", { date: "2026-02-01", groupId: "trip-g2" })], UTC)).toHaveLength(0);
    });

    it("ふだんのまとめ投稿（trip- の無い束）は日付の一冊に入る", () => {
        const g = "0D5C2F4E-1111-2222-3333-444455556666";
        const shelf = shelfTrips([
            photo("d1", { date: "2026-08-01" }), photo("g1", { date: "2026-08-02", groupId: g }),
            photo("g2", { date: "2026-08-02", groupId: g }), photo("g3", { date: "2026-08-03", groupId: g }),
            photo("d5", { date: "2026-08-06" }), photo("d6", { date: "2026-08-07" }),
        ], UTC);
        expect(shelf).toHaveLength(1);
        expect(ids(shelf[0].photos)).toEqual(["d1", "g1", "g2", "g3", "d5", "d6"]);
    });

    it("下書きは日付の一冊に入れない・棚は新しい順", () => {
        const shelf = shelfTrips([
            photo("old-a", { date: "2025-01-01" }), photo("old-b", { date: "2025-01-02" }),
            photo("mid-a", { date: "2026-03-01" }), photo("mid-b", { date: "2026-03-02" }),
            photo("draft", { date: "2026-03-02", published: false }),
        ], UTC);
        expect(shelf.map((t) => t.photos[0].id)).toEqual(["mid-a", "old-a"]);
        expect(ids(shelf[0].photos)).toEqual(["mid-a", "mid-b"]);
    });
});

describe("人のページの棚（ProfileTravelRecord）", () => {
    it("公開写真だけ・ブロックの関係なら何も作らない", () => {
        const list = [
            photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-02" }),
            photo("f", { date: "2026-05-02", audience: "followers" }), photo("d", { date: "2026-05-02", published: false }),
            photo("e", { date: "2026-05-02", audience: "everyone" }),
        ];
        // "everyone" も公開範囲を持っている＝隠す（サーバーの公開の口 `isRestricted` と同じ）
        expect(ids(profileTripPhotos(list, false))).toEqual(["a", "b"]);
        expect(profileTripPhotos(list, true)).toEqual([]);
    });

    it("公開範囲の読み方はサーバーの公開の口と同じ（持っていれば隠す・空白だけは持っていない）", () => {
        const cases: [unknown, boolean][] = [
            [undefined, true], [null, true], ["", true], ["  ", true],
            ["everyone", false], ["followers", false], ["closeFriends", false], ["typo", false], [false, false], [0, false],
        ];
        for (const [audience, shown] of cases) {
            expect(isPublicPhoto(photo("x", { audience })), JSON.stringify(audience)).toBe(shown);
        }
        expect(isPublicPhoto(photo("x", { published: false }))).toBe(false);
    });

    it("一冊は写真の id で引ける・URL はクエリの形", () => {
        const shelf = shelfTrips([photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-02" })]);
        expect(findTrip(shelf, "b")?.id).toBe("a-b");
        expect(findTrip(shelf, "zzz")).toBeNull();
        expect(tripBookPath("u 1", shelf[0])).toBe("/users/trip?id=u%201&p=a");
    });
});

describe("実データ（app/data/photos.json の撮影日のある8枚）と同じ形", () => {
    // 2026-10-21 時点の公開30枚のうち撮影日のある8枚（撮影地と日付だけ写した）。iOS の棚と同じく2冊になる
    const REAL = [
        ["a1294", "2026-04-29", "山中湖"], ["88c66", "2026-04-29", "山中湖"], ["edb09", "2024-10-12", "バルセロナ"],
        ["a5951", "2024-10-11", "パリ"], ["ab5e9", "2025-08-31", "大阪"], ["50b9f", "2024-03-24", "東京"],
        ["65300", "2023-06-21", "東京"], ["30891", "2026-01-02", "フィンランド"],
    ].map(([id, date, location]) => photo(id, { date, location, user: "67d49a68" }));

    it("山中湖の旅（1日・2枚）と パリの旅（2日・2枚）", () => {
        const shelf = shelfTrips(REAL, TOKYO);
        expect(shelf.map((t) => [tripTitle(t), tripLine(t)])).toEqual([
            ["山中湖の旅", "2026.04.29 · 1日間 · 2枚"],
            ["パリの旅", "2024.10.11 — 10.12 · 2日間 · 2枚"],
        ]);
    });
});

describe("速さの直し（2026-10-21）: 答えは変えない", () => {
    // 直す前の作り方（並べてから撮影日の無い写真を落とす）。答えがこれと同じことを見張る
    const before = (list: TripPhoto[], tz: string) => {
        const dated = inOrder(list, tz).filter(hasTakenDay).map((p) => ({ p, d: dayOf(p, tz) as number }));
        const groups: { p: TripPhoto; d: number }[][] = [];
        for (const item of dated) {
            const last = groups[groups.length - 1]?.at(-1);
            if (last && item.d - last.d <= 3) groups[groups.length - 1].push(item); else groups.push([item]);
        }
        return groups.filter((g) => g.length >= 2).map((g) => g.map((x) => x.p.id));
    };
    const mixed: TripPhoto[] = [
        photo("u1", { createdAt: "2026-05-02T01:00:00Z" }),
        photo("b", { date: "2026-05-02", createdAt: "2026-05-02T09:00:00Z" }),
        photo("a", { date: "2026-05-02", createdAt: "2026-05-02T03:00:00Z" }),
        photo("same1", { date: "2026-05-03" }), photo("same2", { date: "2026-05-03" }),
        photo("u2", { createdAt: "not a date" }),
        photo("c", { date: "2026-05-01T23:00:00", createdAt: "2026-04-30T23:00:00+09:00" }),
        photo("far1", { date: "2026-06-20" }), photo("u3"), photo("far2", { date: "2026-06-23" }),
        photo("lone", { date: "2026-08-01" }),
    ];

    it("撮影日の無い写真を先に落としても、旅の分け方と並びは同じ", () => {
        for (const tz of [UTC, TOKYO]) {
            expect(trips(mixed, tz).map((t) => ids(t.photos)).reverse(), tz).toEqual(before(mixed, tz));
        }
    });

    it("撮影日の無い写真のために暦の計算をしない（先に落とす）", () => {
        const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
        try {
            trips([
                photo("a", { date: "2026-05-01" }), photo("b", { date: "2026-05-02" }),
                ...Array.from({ length: 20 }, (_, i) => photo(`u${i}`, { createdAt: `2026-05-01T0${i % 10}:00:00Z` })),
            ], TOKYO);
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    it("暦日の書式は時刻帯ごとに1つだけ作る", () => {
        const Orig = Intl.DateTimeFormat;
        let made = 0;
        const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
            made++;
            return new Orig(...args);
        } as unknown as typeof Intl.DateTimeFormat;
        Counting.prototype = Orig.prototype;
        Intl.DateTimeFormat = Counting;
        try {
            for (let i = 0; i < 30; i++) dayOf(photo(`m${i}`, { createdAt: `2026-05-01T1${i % 10}:00:00Z` }), "America/Denver");
            expect(made).toBeLessThanOrEqual(1);
            // 答えは時刻帯の暦日のまま（デンバーの 2026-05-01 10:00Z は 04:00 の 5月1日）
            expect(dayOf(photo("d", { createdAt: "2026-05-01T05:00:00Z" }), "America/Denver")).toBe(day("2026-04-30"));
        } finally {
            Intl.DateTimeFormat = Orig;
        }
    });

    it("読めない時刻帯は前と同じく日を決めない（覚えない）", () => {
        expect(dayOf(photo("z", { createdAt: "2026-05-01T05:00:00Z" }), "Not/AZone")).toBeNull();
        expect(dayOf(photo("z", { createdAt: "2026-05-01T05:00:00Z" }), "Not/AZone")).toBeNull();
    });
});
