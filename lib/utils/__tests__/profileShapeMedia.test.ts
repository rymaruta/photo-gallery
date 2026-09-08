import { describe, it, expect } from "vitest";
import { sanitizeProfile } from "../profileShape";

// **サーバーの許可リストは「これから保存する値」にしか効かない。**
// 許可リストを入れる前に保存された行（曲の音源・アートワーク・リンク）は
// 任意のホストのまま残りうる（本番を読めないので実態は未確認）。
// 画面はそれを `<audio src>` `<img src>` `<a href>` で読み込むので、
// **開いた人の IP・User-Agent・時刻が外部に渡る**。出すときにも確かめる。

const withSong = (song: Record<string, unknown>) =>
    sanitizeProfile({ userId: "u1", songs: [song] }, "test") as { songs?: Array<Record<string, unknown>> } | null;

describe("sanitizeProfile: 曲の URL は出すときにも確かめる", () => {
    it("許可していないホストの音源は落とす", () => {
        const p = withSong({ title: "x", previewUrl: "https://evil.example/track.m4a" });
        expect(p?.songs?.[0].previewUrl, "外部の音源を読み込ませている").toBe("");
    });

    it("許可していないホストのアートワークは落とす", () => {
        const p = withSong({ title: "x", previewUrl: "", artwork: "https://evil.example/a.jpg" });
        expect(p?.songs?.[0].artwork).toBeUndefined();
    });

    it("許可していないホストのリンクは落とす", () => {
        const p = withSong({ title: "x", previewUrl: "", trackUrl: "https://evil.example/song" });
        expect(p?.songs?.[0].trackUrl).toBeUndefined();
    });

    // **末尾一致では足りない**（`evil-mzstatic.com` が通る）ことも見る
    it("紛らわしいホストも落とす", () => {
        const p = withSong({ title: "x", previewUrl: "https://evil-mzstatic.com/x.m4a" });
        expect(p?.songs?.[0].previewUrl).toBe("");
    });

    // 正常系: 本物の Apple のホストは通す（塞ぎすぎない）
    it("Apple のホストは通す", () => {
        const p = withSong({
            title: "x",
            previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
            artwork: "https://is1-ssl.mzstatic.com/image/100x100.jpg",
            trackUrl: "https://music.apple.com/jp/album/1",
        });
        expect(p?.songs?.[0].previewUrl).toBe("https://audio-ssl.itunes.apple.com/preview.m4a");
        expect(p?.songs?.[0].artwork).toBe("https://is1-ssl.mzstatic.com/image/100x100.jpg");
        expect(p?.songs?.[0].trackUrl).toBe("https://music.apple.com/jp/album/1");
    });

    // 旧い形（プロフィール直下の songArtwork / songPreviewUrl / songUrl）も同じ
    it("プロフィール直下の曲の項目も確かめる", () => {
        const p = sanitizeProfile({
            userId: "u1",
            songArtwork: "https://evil.example/a.jpg",
            songPreviewUrl: "https://evil.example/p.m4a",
            songUrl: "https://evil.example/s",
        }, "test") as Record<string, unknown> | null;
        expect(p?.songArtwork).toBeUndefined();
        expect(p?.songPreviewUrl).toBeUndefined();
        expect(p?.songUrl).toBeUndefined();
    });

    it("直下の項目も Apple のホストなら通す", () => {
        const p = sanitizeProfile({
            userId: "u1",
            songArtwork: "https://is1-ssl.mzstatic.com/a.jpg",
            songPreviewUrl: "https://audio-ssl.itunes.apple.com/p.m4a",
            songUrl: "https://music.apple.com/jp/album/1",
        }, "test") as Record<string, unknown> | null;
        expect(p?.songArtwork).toBe("https://is1-ssl.mzstatic.com/a.jpg");
        expect(p?.songPreviewUrl).toBe("https://audio-ssl.itunes.apple.com/p.m4a");
        expect(p?.songUrl).toBe("https://music.apple.com/jp/album/1");
    });
});
