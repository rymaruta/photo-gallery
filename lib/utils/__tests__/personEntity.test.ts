import { describe, it, expect } from "vitest";
import { personEntity, safeSameAs, instagramUrl } from "../personEntity";

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
