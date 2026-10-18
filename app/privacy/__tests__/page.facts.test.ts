import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// **プライバシーポリシーに書いた数・項目と、実装が食い違わないか。**
//
// 2026-10-18 に、公開プロフィール・ストーリー・すれちがい・旅のトランク・光と天気の知らせ・
// プッシュ通知の節を足した。本文には実装の上限（何件まで残す・何台まで・何時間以内）と、
// 公開プロフィールに載る項目をそのまま書いている。実装を変えたのに本文を直さないと、
// **法的な文が実際の扱いと違うことを言い続ける**ので、実装のソースから読んで突き合わせる。
//
// api-user のモジュールは読み込み時に環境変数（`USERS_TABLE` など）を要求するので
// import せず、ソースを文字で読む。

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");
const page = read("app/privacy/page.tsx");

/** `export const NAME = 1_000;` の値を読む（読めなければ落とす） */
function constOf(file: string, name: string): number {
    const m = read(file).match(new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)\\s*;`));
    expect(m, `${file} に ${name} が見つからない`).not.toBeNull();
    return Number(m![1].replace(/_/g, ""));
}

describe("プライバシーポリシーの数が実装と合っている", () => {
    it("旅のトランク: 配った投稿の記録は 3,000 件まで", () => {
        const n = constOf("api-user/src/trunk.ts", "DEALT_LEDGER_MAX");
        expect(page, "本文の件数が実装と違う").toContain(`新しい方から${n.toLocaleString("en-US")}件まで`);
    });

    it("旅のトランク: 取り消しと硬貨の記録は、実装の時間（REVOKE_WINDOW_MS）と同じ時間で書いてある", () => {
        const m = read("api-user/src/trunk.ts").match(/export const REVOKE_WINDOW_MS = (\d+) \* 3_600_000;/);
        expect(m, "REVOKE_WINDOW_MS が「時間 × 3_600_000」の形で読めない").not.toBeNull();
        const h = Number(m![1]);
        for (const phrase of [`投稿から${h}時間以内に写真を削除・非公開`, `${h}時間を過ぎたものを落とします`, `${h}時間以内に硬貨を配った投稿`]) {
            expect(page, `本文に「${phrase}」が無い（時間が実装とずれた）`).toContain(phrase);
        }
        // 時間を書き換えた本文が混ざっていない（実装と違う時間を1つも言わない）
        const hours = [...page.matchAll(/(\d+)時間/g)].map((x) => Number(x[1]));
        expect(hours.filter((x) => x !== h), "実装と違う時間が本文にある").toEqual([]);
    });

    it("プッシュ通知: 宛先は1人10台まで", () => {
        const n = constOf("api-user/src/devices.ts", "DEVICES_MAX");
        expect(page, "本文の台数が実装と違う").toContain(`${n}台分まで`);
    });

    it("お知らせ: 他の人のお知らせは50件で押し出される", () => {
        const n = constOf("api-user/src/notify.ts", "NOTIFS_MAX");
        expect(page, "本文の件数が実装と違う").toContain(`新しいもの${n}件に押し出される`);
    });

    it("光と天気の知らせ: 行きたい場所は新しい方から20件まで", () => {
        const n = constOf("api-user/src/lightForecast.ts", "MAX_SPOTS");
        expect(page, "本文の件数が実装と違う").toContain(`新しい方から${n}件まで`);
    });
});

describe("すれちがいの説明が仕組みの事実と合っている", () => {
    it("暗号化していないと言い、暗号化していると言わない", () => {
        expect(page).toContain("この内容は暗号化していません");
        // 「暗号化していません」以外の「暗号化」の言い方（暗号化済み・暗号化して送る・暗号化された…）を全部断る
        const others = [...page.matchAll(/暗号化[^\s、。」）]{0,8}/g)]
            .map((m) => m[0])
            .filter((s) => !s.startsWith("暗号化していません"));
        expect(others, "暗号化していないのに、しているかのように読める言い方がある").toEqual([]);
        expect(page).toContain("日ごとに変わる仕組みはありません");
    });
});

/** 本文の節を1つ切り出す（`<Section title="N. …">` から次の `<Section` まで） */
function sectionOf(n: number): string {
    const start = page.indexOf(`<Section title="${n}. `);
    expect(start, `${n}節が見つからない`).toBeGreaterThanOrEqual(0);
    const next = page.indexOf("<Section title=", start + 1);
    return page.slice(start, next < 0 ? undefined : next);
}

describe("本文の約束が消えていない", () => {
    it("3節: iPhone アプリは撮影地の欄が空のままでも座標を送ると書いてある（PlaceCoordsRule の (a)）", () => {
        expect(sectionOf(3)).toContain("撮影地の欄が空のまま投稿したとき");
        expect(sectionOf(3)).toContain("ストーリーの投稿と写真の差し替えにも同じ条件が当てはまります");
    });

    /**
     * iOS の「撮影地の位置を付ける」切り替え（journey.photo-ios #290・e2a0464・1.1.14 から）。
     * 名前は iOS の `UploadDetails.locationToggleTitle` の文言そのまま（別のリポジトリなので文字で持つ）。
     * 切り替えの無い前の版も出回っているので、「切り替えは無い」とも「全部の版で切り替えられる」とも言わない
     */
    it("3節: iPhone アプリの新しい版の切り替えと、前の版の動きを両方書いてある", () => {
        const s3 = sectionOf(3);
        expect(s3).toContain("「撮影地の位置を付ける（約1kmに丸めて保存）」で切り替えられます（初期状態はオンです）");
        expect(s3).toContain("投稿・ストーリー・写真の差し替えの画面");
        expect(s3).toContain("オフにすると写真の位置情報は送らず");
        expect(s3, "前の版の動きが抜けている（まだ切り替えの無い版が出回っている）").toContain("この切り替えの無い前の版では、上の条件のとおり送ります");
        expect(s3, "切り替えが入ったのに、無いと言っている").not.toContain("切り替えはありません");
    });

    it("11節: API のログの保存期間は serverless の logRetentionInDays と同じ日数で、全部とは言い切らない", () => {
        const days = ["api/serverless.yml", "api-user/serverless.yml"].map((f) => {
            const m = read(f).match(/^\s*logRetentionInDays:\s*(\d+)\s*$/m);
            expect(m, `${f} に logRetentionInDays が無い（ログが無期限に戻った）`).not.toBeNull();
            return Number(m![1]);
        });
        expect(new Set(days).size, "api と api-user で保存期間が違う。本文の書き方を見直すこと").toBe(1);
        const s11 = sectionOf(11);
        expect(s11, "本文の日数が設定と違う").toContain(`API サーバーのログは${days[0]}日で自動的に消えます`);
        // Lambda@Edge（OGP）のログは期限が付いていない。全部が消えるとは言わない
        expect(s11).toContain("まだ保存期間を設けていないものがあります");
        expect(s11, "ログ全部に期限があるかのように書いている").not.toMatch(/(すべて|全て|全部)の(動作記録|ログ)/);
    });

    it("5節: アーカイブに移るとき、閲覧の記録と他の方の返信を消すと書いてある", () => {
        expect(sectionOf(5)).toContain("アーカイブに移るとき、閲覧の記録と他の方からの返信は消します");
    });

    it("10節: 範囲を絞った写真も、画像のアドレスを知っている人は開けると書いてある", () => {
        expect(sectionOf(10)).toContain("ログインしている対象の方にだけ表示されます（ウェブサイトには表示されません）");
        expect(sectionOf(10)).toContain("画像のアドレスを知っている人は、そのアドレスから画像を開けることがあります");
    });
});

describe("最終更新日", () => {
    it("本文の最終更新日と、サイトマップの更新日が同じ日", () => {
        const m = page.match(/const LAST_UPDATED = "(\d{4})年(\d{1,2})月(\d{1,2})日";/);
        expect(m, "LAST_UPDATED が読めない").not.toBeNull();
        const iso = `${m![1]}-${m![2].padStart(2, "0")}-${m![3].padStart(2, "0")}`;
        const s = read("app/sitemap.ts").match(/const PRIVACY_LAST_MODIFIED = "(\d{4}-\d{2}-\d{2})";/);
        expect(s, "PRIVACY_LAST_MODIFIED が読めない").not.toBeNull();
        expect(s![1], "サイトマップの更新日がポリシーの最終更新日と違う").toBe(iso);
    });
});

/**
 * 公開プロフィールの節が、**公開の形（`toPublicProfile`）が返す項目**を全部言っているか。
 *
 * ⚠️ **返す側だけを読む。** 関数の頭の分解（`const { … } = p;`）にも同じ名前が並ぶので、
 * ソース全体で探すと、返す側から項目を消しても通ってしまう。
 */
function returnedPublicFields(): Set<string> {
    const src = read("api-user/src/userProfile.ts");
    const start = src.indexOf("export function toPublicProfile(");
    expect(start, "toPublicProfile が見つからない").toBeGreaterThanOrEqual(0);
    const body = src.slice(start);
    const open = body.indexOf("return withCheckedSongUrls({");
    expect(open, "toPublicProfile の返す形が読めない").toBeGreaterThanOrEqual(0);
    const close = body.indexOf("\n    });", open);
    expect(close, "返す形の終わりが読めない").toBeGreaterThan(open);
    const block = body
        .slice(open + "return withCheckedSongUrls({".length, close)
        .replace(/\/\/[^\n]*/g, "");
    const out = new Set<string>();
    // `...badgeFields(p)` などの広げは、関数の名前で1項目として数える
    for (const m of block.matchAll(/\.\.\.\s*(?:\(\s*opts\.owner[^:]*:\s*)?([A-Za-z]+)\(/g)) out.add(`...${m[1]}`);
    const plain = block.replace(/\.\.\.[^\n]*/g, "");
    for (const m of plain.matchAll(/([A-Za-z]+)\s*(?=[,:\n])/g)) out.add(m[1]);
    return out;
}

/**
 * 公開の形の項目 → 本文（4節）で説明している言い方。
 * **項目の並びごと見る**——「居住地」1語だけだと、同じ節の注記（「居住地は自由入力の…」）に当たって、
 * 一覧から消しても通ってしまう
 */
const FIELD_PHRASE: Record<string, string> = {
    userId: "利用者ID、プロフィールの更新日時",
    updatedAt: "利用者ID、プロフィールの更新日時",
    username: "ご自身で設定した項目: 表示名、ユーザー名、",
    displayName: "ご自身で設定した項目: 表示名、",
    bio: "自己紹介、居住地、ひとこと",
    instagram: "外部リンク（Instagram・ウェブサイト）",
    website: "外部リンク（Instagram・ウェブサイト）",
    themeColor: "テーマの色、プロフィールの曲",
    songUrl: "プロフィールの曲",
    songStart: "プロフィールの曲",
    songEnd: "プロフィールの曲",
    songTitle: "プロフィールの曲",
    songArtist: "プロフィールの曲",
    songArtwork: "プロフィールの曲",
    songPreviewUrl: "プロフィールの曲",
    songTrackUrl: "プロフィールの曲",
    songs: "プロフィールの曲",
    pinnedPhotoIds: "ピン留めした写真",
    tripTitles: "旅アルバムの名前・カバー・曲",
    tripCovers: "旅アルバムの名前・カバー・曲",
    tripSongs: "旅アルバムの名前・カバー・曲",
    statusText: "自己紹介、居住地、ひとこと",
    homeLocation: "自己紹介、居住地、ひとこと",
    verified: "認証済みの印",
    passFace: "特別な乗車券の券面を表示してよいか",
    "...badgeFields": "サポーターの番号・申し込んだ日・続けた月数",
    "...withoutRemovedMarks": "名前の横の Pro の印を外した場合に隠れるのは",
};

describe("公開プロフィールの節が公開の形と合っている", () => {
    const fields = returnedPublicFields();

    it("返す形が読めている（空振りで緑にならない）", () => {
        for (const k of ["userId", "homeLocation", "passFace", "...badgeFields"]) {
            expect(fields.has(k), `返す形から ${k} を読めていない`).toBe(true);
        }
    });

    it("返す項目の一覧が、本文で説明している一覧と同じ", () => {
        // 足しても消しても落ちる。足したなら本文に書き、FIELD_PHRASE に足す。
        // 消したなら本文から外し、FIELD_PHRASE からも外す
        expect([...fields].sort(), "公開の形の項目が変わった。本文の4節を見直すこと")
            .toEqual(Object.keys(FIELD_PHRASE).sort());
    });

    it("どの項目も、4節（公開プロフィール）の中で説明している", () => {
        // 本文のどこかに1回出るだけでは足りない（別の節の同じ言葉に当たって通ってしまう）
        const s4 = sectionOf(4);
        for (const [k, phrase] of Object.entries(FIELD_PHRASE)) {
            expect(s4, `${k} の説明（${phrase}）が4節に無い`).toContain(phrase);
        }
    });

    it("印を外しても Pro か分かること・番号とメダルが公開のままであることを、4節で言っている", () => {
        const s4 = sectionOf(4);
        expect(s4).toContain("いま Pro であるかどうかは他の方に分かります");
        expect(s4).toContain("サポーターの番号・続けた月数とメダルも、印を外しても公開のままです");
    });
});

/**
 * 5節「旅のトランク」が、**人のトランクの口（`GET /users/{uid}/trunk`・`readTheirTrunk`）**と合っているか。
 *
 * 2026-10-18 判断: 本番に人のトランクの口が出た（photo-gallery #409）のに、本文が「中身はご本人だけが見られます」の
 * ままだった。返す項目・ラベルの地名の出し方・見せない設定の既定値を実装から読んで突き合わせ、
 * 片方だけ変えたら落ちるようにする（refs rymaruta/journey.photo-ios#299）。
 */
function trunkSection(): string {
    const s5 = sectionOf(5);
    const start = s5.indexOf('title="旅のトランク（iPhone アプリ）"');
    expect(start, "5節に旅のトランクの項が無い").toBeGreaterThanOrEqual(0);
    const next = s5.indexOf("<Feature", start + 1);
    return s5.slice(start, next < 0 ? undefined : next);
}

/** `readTheirTrunk` の返す形の項目（入れ子の `inside` の中身も含む） */
function returnedTheirTrunkFields(): Set<string> {
    const src = read("api-user/src/trunk.ts");
    const start = src.indexOf("export async function readTheirTrunk(");
    expect(start, "readTheirTrunk が見つからない").toBeGreaterThanOrEqual(0);
    const body = src.slice(start);
    const open = body.indexOf("    return {");
    expect(open, "readTheirTrunk の返す形が読めない").toBeGreaterThanOrEqual(0);
    const close = body.indexOf("\n    };", open);
    expect(close, "返す形の終わりが読めない").toBeGreaterThan(open);
    const block = body.slice(open + "    return {".length, close).replace(/\/\/[^\n]*/g, "");
    const out = new Set<string>();
    for (const m of block.matchAll(/([A-Za-z]+)\s*:/g)) out.add(m[1]);
    for (const m of block.matchAll(/^\s*([A-Za-z]+),\s*$/gm)) out.add(m[1]);
    return out;
}

/** 人のトランクの項目 → 5節（旅のトランク）で説明している言い方 */
const THEIR_TRUNK_PHRASE: Record<string, string> = {
    userId: "あなたのプロフィールからトランクを見られます",
    model: "見えるのは、トランクの型",
    stuck: "貼ったラベル（図案と貼った位置）",
    equipped: "付けている部品、公開している投稿の数",
    posts: "公開している投稿の数",
    inside: "トランクの中の",
    badges: "トランクの中のメダル（公開プロフィールと同じもの）",
    card: "会員証（いま Pro かどうかだけ。サポーターの番号・始めた時期・月数は出しません）",
    ticket: "わたしの乗車券（入れる設定にしている場合だけ。",
};

describe("旅のトランクの節が、人のトランクの口と合っている", () => {
    const trunk = trunkSection();
    const src = read("api-user/src/trunk.ts");

    it("返す形が読めている（空振りで緑にならない）", () => {
        const fields = returnedTheirTrunkFields();
        for (const k of ["model", "stuck", "inside", "ticket"]) {
            expect(fields.has(k), `返す形から ${k} を読めていない`).toBe(true);
        }
    });

    it("返す項目の一覧が、本文で説明している一覧と同じ", () => {
        // 足しても消しても落ちる。足したなら本文に書き、THEIR_TRUNK_PHRASE に足す
        expect([...returnedTheirTrunkFields()].sort(), "人のトランクの項目が変わった。5節の旅のトランクを見直すこと")
            .toEqual(Object.keys(THEIR_TRUNK_PHRASE).sort());
    });

    it("どの項目も、旅のトランクの項の中で説明している", () => {
        for (const [k, phrase] of Object.entries(THEIR_TRUNK_PHRASE)) {
            expect(trunk, `${k} の説明（${phrase}）が旅のトランクの項に無い`).toContain(phrase);
        }
    });

    it("「ご本人だけが見られる」「公開しない」と言っていない", () => {
        expect(trunk).not.toContain("中身はご本人だけが見られます");
        expect(trunk).not.toContain("ご本人だけが見られ、公開しません");
        expect(trunk).toContain("ログインしている他の方もあなたのプロフィールから見られます");
        // 4節（公開する情報）からもトランクを指している
        expect(sectionOf(4)).toContain("旅のトランク（「5. 機能ごとの情報の扱い」）を見ることができます");
    });

    it("ラベルの地名は、確かめた物だけ見せ、それ以外は地名・日付なしの同じ形（theirLabel・placeOkFor）", () => {
        // 実装: 印（placeOk）の無いラベル・地名が空のラベルは、地名も日付も落とした同じ形
        expect(src).toContain('if (!l.placeOk || !l.place.name) return { ...base, place: { name: "" }, where: null };');
        // 実装: 日付は日付だけ
        expect(src).toContain("at: l.at.slice(0, 10),");
        // 実装: 印の根拠は、本人の・誰にでも見える公開の写真で、撮影地が今もラベルと同じ
        const place = read("api-user/src/trunkPlace.ts");
        expect(place).toContain("if (!row || ownerOf(row) !== uid || !isPublicListPhoto(row)) return false;");
        expect(place).toContain("return placeKey(placeOf(row as unknown as Photo)) === placeKey(place);");
        expect(trunk).toContain("配られた日（日付だけ）");
        expect(trunk).toContain("元の写真が誰にでも見える公開のままで、撮影地も配られたときと同じだと確かめられたものだけ見せます");
        expect(trunk).toContain("地名も日付も無い封の図案として見せます");
        // 乗車券も本人の公開写真のときだけ
        expect(src).toContain("if (isOwnPublicPhoto(res.Item as Record<string, unknown> | undefined, target)) {");
        expect(trunk).toContain("わたしの乗車券も、その写真があなたの公開中の写真であるときだけ見せます");
    });

    it("見せない設定の既定値が実装と同じ（「トランクを見せる」は既定オン・乗車券は置くまで無い）", () => {
        const parse = src.slice(src.indexOf("export function parseTrunk("));
        // 既定オン＝ false と明示したときだけ見せない
        const on = /showTrunk: item\?\.showTrunk !== false,/.test(parse);
        const off = /showTrunk: item\?\.showTrunk === true,/.test(parse);
        expect(on || off, "parseTrunk の showTrunk の既定が読めない").toBe(true);
        expect(trunk).toContain(`「トランクを見せる」（初期状態は${on ? "オン" : "オフ"}）`);
        // 乗車券は、本人が置いたとき（保存した行に ticket があるとき）だけ持つ
        expect(parse).toContain("...(storedTicket(item?.ticket) ? { ticket: storedTicket(item?.ticket) } : {}),");
        expect(trunk).toContain("「わたしの乗車券もトランクに入れる」は初期状態はオフです");
    });

    it("見せないときの 404 は理由を区別しない（見せない設定・ブロック・退会）", () => {
        expect(src).toContain("if (!profile || isDeletedProfile(profile) || !row || blocked) throw new HiddenTrunk();");
        expect(src).toContain("if (!doc.showTrunk && !self) throw new HiddenTrunk();");
        expect(src).toContain('if (e instanceof HiddenTrunk) return jsonError(404, "見つかりません", "notFound");');
        expect(trunk).toContain("どの理由かを区別せずに「見つからない」と返します");
    });

    it("他の方に見えないものを言っている（硬貨・手持ち・部品箱・写真のID）", () => {
        for (const phrase of ["手持ちのラベル", "硬貨の枚数", "部品箱とかけら", "ラベルの元の写真のID"]) {
            expect(trunk, `見えないものに「${phrase}」が無い`).toContain(phrase);
        }
    });
});
