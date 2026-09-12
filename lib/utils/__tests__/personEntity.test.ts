import { describe, it, expect } from "vitest";
import { personEntity, safeSameAs, instagramUrl } from "../personEntity";
import { spacelessName } from "../nameVariants";

/**
 * **人名で探されたときに1位を取る、という owner の指示（2026-09-12）。**
 *
 * 実ビルドで測った当時の姿:
 *   `/users/<id>`  Person は **名前・URL・画像の3つだけ**（sameAs 無し）
 *   写真ページ30枚  表示名は5回出るのに、構造化データは `creator` の名前だけ
 *                   （`author` も `<meta name="author">` も無し）
 *
 * 名前だけでは**同姓同名と区別が付かない**。同定に効くのは
 * `sameAs`（他所の自分）と `mainEntityOfPage`（このページがその人のページ）。
 */
describe("人の構造化データ", () => {
    const base = { id: "u1", displayName: "丸田 竜平" };

    it("このページがその人のページだと名乗る", () => {
        const p = personEntity(base);
        expect(p["@type"]).toBe("Person");
        expect(p.name).toBe("丸田 竜平");
        expect(p.url).toContain("/users/u1");
        expect(p.mainEntityOfPage, "その人のページだと名乗っていない").toBe(p.url);
    });

    it("自己紹介と外部リンクを出す（同定の手がかり）", () => {
        const p = personEntity({ ...base, profile: {
            bio: "旅の写真を撮っています", website: "https://example.com/me", instagram: "ryuhei",
        } });
        expect(p.description).toBe("旅の写真を撮っています");
        expect(p.sameAs).toEqual(["https://example.com/me", "https://www.instagram.com/ryuhei/"]);
    });

    // **無い項目は生やさない**（空の description は出さない方がよい）
    it("持っていない項目は出さない", () => {
        const p = personEntity(base);
        expect("description" in p).toBe(false);
        expect("sameAs" in p).toBe(false);
        expect("image" in p).toBe(false);
    });

    it("空白だけの自己紹介は出さない", () => {
        expect("description" in personEntity({ ...base, profile: { bio: "   " } })).toBe(false);
    });

    // **保存側の検証は「これから保存する値」にしか効かない**
    // （判定を入れる前の行は残りうる）。ここでももう一度見る
    it("http(s) 以外のリンクは sameAs に出さない", () => {
        for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x/y", "example.com", ""]) {
            expect(safeSameAs(bad), `${bad} を通している`).toBeUndefined();
        }
        expect(safeSameAs("https://example.com/me")).toBe("https://example.com/me");
        expect(safeSameAs(" http://example.com ")).toBe("http://example.com/");
    });

    it("Instagram は @名でも URL でも受ける（他所のホストは受けない）", () => {
        expect(instagramUrl("@ryuhei")).toBe("https://www.instagram.com/ryuhei/");
        expect(instagramUrl("ryuhei")).toBe("https://www.instagram.com/ryuhei/");
        expect(instagramUrl("https://www.instagram.com/ryuhei/")).toBe("https://www.instagram.com/ryuhei/");
        expect(instagramUrl("https://evil.example/ryuhei"), "別のホストを通している").toBeUndefined();
        expect(instagramUrl("ryu hei"), "空白入りを URL に混ぜている").toBeUndefined();
        expect(instagramUrl("../../etc"), "パスを混ぜている").toBeUndefined();
        expect(instagramUrl("")).toBeUndefined();
    });

    // **片方だけでも出す**（両方揃うまで待たない）
    it("リンクが片方だけでも出す", () => {
        expect(personEntity({ ...base, profile: { website: "https://a.example" } }).sameAs)
            .toEqual(["https://a.example/"]);
        expect(personEntity({ ...base, profile: { instagram: "x" } }).sameAs)
            .toEqual(["https://www.instagram.com/x/"]);
    });
});

/**
 * **空白を詰めた別表記。** owner が挙げた検索語は「丸田竜平」と
 * 「丸田　竜平」で、**保存されている表示名（「丸田 竜平」）とはどちらも
 * 綴りが違う**。schema.org の `alternateName` に詰めた形を出す。
 */
describe("空白を詰めた別表記", () => {
    it("日本語の姓名は、空白を詰めた形も名乗る", () => {
        expect(spacelessName("丸田 竜平")).toBe("丸田竜平");
        // 全角空白でも同じ
        expect(spacelessName("丸田\u3000竜平")).toBe("丸田竜平");
        expect(personEntity({ id: "u1", displayName: "丸田 竜平" }).alternateName).toBe("丸田竜平");
    });

    it("ラテン文字が混じる名前には当てない（実在しない綴りを作らない）", () => {
        expect(spacelessName("John Smith")).toBeUndefined();
        expect(spacelessName("丸田 Ryuhei")).toBeUndefined();
        expect(spacelessName("Journey Photo")).toBeUndefined();
        expect("alternateName" in personEntity({ id: "u1", displayName: "John Smith" })).toBe(false);
    });

    /**
     * **`name` と同じ文字列を `alternateName` に出さない。** 前後の空白しか
     * 無い名前で `trim()` を落とすと、詰めた形が表示名と一致したまま
     * 「別の呼び名」として出る（保存側は trim 済みなので本番では起きないが、
     * この関数が守るべき不変条件）
     */
    it("前後の空白しか無い名前では別表記を作らない", () => {
        expect(spacelessName("  丸田竜平  ")).toBeUndefined();
        expect(spacelessName("丸田竜平\u3000")).toBeUndefined();
    });

    it("空白が無ければ別表記は生まれない", () => {
        expect(spacelessName("丸田竜平")).toBeUndefined();
        expect(spacelessName("")).toBeUndefined();
        expect(spacelessName("   ")).toBeUndefined();
        expect("alternateName" in personEntity({ id: "u1", displayName: "丸田竜平" })).toBe(false);
    });

    it("仮名・長音・繰り返し記号も日本語名として通す", () => {
        expect(spacelessName("さくら ひなの")).toBe("さくらひなの");
        // 長音符「ー」（U+30FC）
        expect(spacelessName("マリー ローランサン")).toBe("マリーローランサン");
        // 繰り返し記号「々」（U+3005）・小書き「ヶ」（U+30F6）
        expect(spacelessName("佐々木 蔦ヶ谷")).toBe("佐々木蔦ヶ谷");
        // 「〆」（U+3006）・「〇」（U+3007）。〇 は名前を伏せるときに使う
        expect(spacelessName("井〆 一")).toBe("井〆一");
        expect(spacelessName("〇〇 太郎")).toBe("〇〇太郎");
        // ゝゞ（U+309D/309E）
        expect(spacelessName("さゝ木 一")).toBe("さゝ木一");
    });

    /**
     * **基本の漢字（U+4E00-9FFF）だけでは足りない。** どれも実在する姓名の
     * 字で、**弾いた側は静かに何も出ない**（気づく手がかりが無い）。
     */
    it("互換漢字・拡張漢字の名字も通す", () => {
        expect(spacelessName("山﨑 太郎"), "﨑 U+FA11（互換漢字）").toBe("山﨑太郎");
        expect(spacelessName("𠮷田 太郎"), "𠮷 U+20BB7（拡張B・サロゲートペア）").toBe("𠮷田太郎");
        expect(spacelessName("髙橋 花子"), "髙 U+9AD9").toBe("髙橋花子");
        // 拡張A（U+3400-4DBF）
        expect(spacelessName("㐂 一郎")).toBe("㐂一郎");
    });

    /**
     * **「仮名・漢字だけ」と説明した以上、記号だけの名前は通さない。**
     * 仮名の塊（U+3040-30FF）をそのまま通すと、濁点記号・中黒・二重
     * ハイフンまで入り、JSON-LD に意味の無い別表記が出る
     */
    it("記号だけの名前は別表記にしない", () => {
        expect(spacelessName("・ ・"), "中黒 U+30FB").toBeUndefined();
        expect(spacelessName("゛ ゜"), "濁点・半濁点 U+309B/309C").toBeUndefined();
        expect(spacelessName("゠ ゠"), "二重ハイフン U+30A0").toBeUndefined();
    });

    it("半角カナ・全角英数は日本語名として扱わない", () => {
        expect(spacelessName("ﾏﾙﾀ ﾘｭｳﾍｲ")).toBeUndefined();
        expect(spacelessName("Ａ Ｂ")).toBeUndefined();
        expect(spacelessName("丸田 🌸")).toBeUndefined();
    });

    // **名乗るのは別表記であって、本来の名前ではない。** name を詰めた形に
    // すると、画面に出ている名前と構造化データが食い違う
    it("本来の名前は空白入りのまま", () => {
        const p = personEntity({ id: "u1", displayName: "丸田 竜平" });
        expect(p.name).toBe("丸田 竜平");
    });
});
