import { describe, it, expect } from "vitest";
import { deriveUploadKey, mediaKeys, MEDIA_FIELDS } from "../mediaKeys";

// 退会とストーリー削除で「消すべき S3 キー」を決めるところ。
// ここが緩いと、保存されている文字列がそのまま DeleteObject のキーになる
// ——つまり他人のファイルを消す経路になる。逆に漏れると、
// EXIF を落とす前の原本（GPS 入り）が公開URLに残り続ける。

describe("deriveUploadKey", () => {
    it("uploads/ 配下のURLからキーを取り出す", () => {
        expect(deriveUploadKey("https://cdn.example.com/uploads/u1/a.jpg")).toBe("uploads/u1/a.jpg");
    });

    it("生のキーはそのまま通す", () => {
        expect(deriveUploadKey("uploads/u1/a.jpg")).toBe("uploads/u1/a.jpg");
    });

    it("profiles/ は拾わない（他人のアイコンを消させない）", () => {
        expect(deriveUploadKey("https://cdn.example.com/profiles/victim")).toBe("");
        expect(deriveUploadKey("profiles/victim")).toBe("");
    });

    it("uploads/ 以外のパスは拾わない", () => {
        expect(deriveUploadKey("https://cdn.example.com/photo/abc")).toBe("");
        expect(deriveUploadKey("/etc/passwd")).toBe("");
        expect(deriveUploadKey("../../uploads/a.jpg")).toBe("");
    });

    // 保存時の検証はデコードしてから見ているのに、ここが生のままだったため
    // 判断が食い違っていた:
    //   https://cdn/up%6Coads/<uid>/x.jpg
    //     検証側 → デコードすると /uploads/... なので保存OK
    //     削除側 → "up%6Coads/..." は uploads/ で始まらないので対象外
    // CloudFront と S3 は %6C をデコードして解決するので画像は普通に表示される。
    // つまり「写真を消しても退会しても、実体だけ公開URLに残り続ける」を
    // 自分で作れた。成功も返るし画面からも消えるのに残る。
    it("パーセントエンコードされたパスもデコードして拾う", () => {
        expect(deriveUploadKey("https://cdn.example.com/up%6Coads/u1/a.jpg")).toBe("uploads/u1/a.jpg");
        expect(deriveUploadKey("https://cdn.example.com/%75ploads/u1/a.jpg")).toBe("uploads/u1/a.jpg");
    });

    it("日本語などのエンコードもデコードして返す（S3 のキーは生の文字）", () => {
        expect(deriveUploadKey("https://cdn.example.com/uploads/u1/%E6%97%85.jpg")).toBe("uploads/u1/旅.jpg");
    });

    it("デコードすると profiles/ になるURLは拾わない", () => {
        expect(deriveUploadKey("https://cdn.example.com/%70rofiles/victim")).toBe("");
    });

    it("URL の .. は解決されたうえで判定される（別の場所を指せない）", () => {
        // new URL がドットセグメントを畳むので、"uploads/u1/../u2/a.jpg" は
        // "uploads/u2/a.jpg" になる。畳んだ結果で判定していれば、
        // 元の見た目に関係なく「実際に指す場所」で扱える。
        expect(deriveUploadKey("https://cdn.example.com/uploads/u1/%2E%2E/u2/a.jpg")).toBe("uploads/u2/a.jpg");
        expect(deriveUploadKey("https://cdn.example.com/uploads/u1/../../profiles/victim")).toBe("");
    });

    it("生キーに .. が入っていたら扱わない（畳む主体がいないため）", () => {
        // このテストは以前、**名前と逆**（そのまま返す）を固定していた。
        // 実装をコメントどおりに直そうとした人が「テストがあるから今のままが
        // 正しい」と誤読する形だった。名前どおりに直した。
        expect(deriveUploadKey("uploads/u1/../u2/a.jpg")).toBe("");
        expect(deriveUploadKey("uploads/u1/%2E%2E/u2/a.jpg")).toBe("");
    });

    it("URL でも生キーでもない値は空", () => {
        expect(deriveUploadKey(undefined)).toBe("");
        expect(deriveUploadKey(null)).toBe("");
        expect(deriveUploadKey(123)).toBe("");
        expect(deriveUploadKey("")).toBe("");
        expect(deriveUploadKey({})).toBe("");
    });
});

describe("mediaKeys", () => {
    it("原本・派生・サムネを漏れなく集める", () => {
        const item = {
            key: "uploads/u1/a.jpg",
            src: "https://cdn/uploads/u1/a.jpg",
            srcOriginal: "https://cdn/uploads/originals/a.jpeg",
            srcAvif: "https://cdn/uploads/u1/a.avif",
            src256: "https://cdn/uploads/u1/a-256.webp",
            thumbSrc: "https://cdn/uploads/u1/a_thumb.webp",
            thumbSm: "https://cdn/uploads/u1/a_thumb-sm.webp",
            thumbAvif: "https://cdn/uploads/u1/a_thumb.avif",
            thumbSmAvif: "https://cdn/uploads/u1/a_thumb-sm.avif",
        };
        const keys = mediaKeys(item);
        // 原本（GPS が入ったまま）を消し忘れない
        expect(keys).toContain("uploads/originals/a.jpeg");
        // key と src は同じものを指すので重複しない
        expect(keys.filter((k) => k === "uploads/u1/a.jpg")).toHaveLength(1);
        expect(keys).toHaveLength(8);
    });

    it("MEDIA_FIELDS に無い項目は見ない（保存値をむやみにキー化しない）", () => {
        const keys = mediaKeys({ someOtherUrl: "https://cdn/uploads/u2/victim.jpg" });
        expect(keys).toEqual([]);
    });

    it("uploads/ 以外を指す項目は消す対象にしない", () => {
        const keys = mediaKeys({ src: "https://cdn/profiles/victim", thumbSrc: "https://evil.example/x.jpg" });
        expect(keys).toEqual([]);
    });

    it("空の item でも落ちない", () => {
        expect(mediaKeys({})).toEqual([]);
    });

    it("列挙する項目は削除経路の想定と一致している", () => {
        // 増やしたのに片方だけ直す、を防ぐための固定
        expect([...MEDIA_FIELDS]).toEqual([
            "key", "src", "srcOriginal", "srcAvif", "src256",
            "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif",
        ]);
    });
});
