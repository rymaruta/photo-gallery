import { describe, it, expect } from "vitest";
import { parseMusicEmbed, musicServiceLabel } from "../music";

describe("parseMusicEmbed", () => {
    it("Spotify のトラックURLを埋め込みに変換する", () => {
        const e = parseMusicEmbed("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
        expect(e).toEqual({ service: "spotify", embedUrl: "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT", height: 152 });
    });

    it("Spotify の intl プレフィックス付きURLも対応する", () => {
        const e = parseMusicEmbed("https://open.spotify.com/intl-ja/album/1DFixLWuPkv3KT3TnV35m3");
        expect(e?.service).toBe("spotify");
        expect(e?.embedUrl).toBe("https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3");
    });

    it("YouTube の watch URL を埋め込みに変換する", () => {
        const e = parseMusicEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        expect(e).toEqual({ service: "youtube", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" });
    });

    it("youtu.be 短縮URLに対応する", () => {
        const e = parseMusicEmbed("https://youtu.be/dQw4w9WgXcQ");
        expect(e?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });

    it("music.youtube.com の watch URL にも対応する", () => {
        const e = parseMusicEmbed("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
        expect(e?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });

    it("再生リスト等の余分なクエリがあっても v を抽出する", () => {
        const e = parseMusicEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDabc&index=2");
        expect(e?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });

    it("YouTube は start / end（秒）で好きな部分を再生できる", () => {
        const e = parseMusicEmbed("https://youtu.be/dQw4w9WgXcQ", 72, 95);
        expect(e?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?start=72&end=95");
    });

    it("start のみ指定できる", () => {
        const e = parseMusicEmbed("https://youtu.be/dQw4w9WgXcQ", 40);
        expect(e?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?start=40");
    });

    it("小数の start は切り捨てる", () => {
        const e = parseMusicEmbed("https://youtu.be/dQw4w9WgXcQ", 40.9);
        expect(e?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?start=40");
    });

    it("end <= start のときは end を付けない", () => {
        const e = parseMusicEmbed("https://youtu.be/dQw4w9WgXcQ", 90, 30);
        expect(e?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?start=90");
    });

    it("Apple Music の URL を埋め込みホストに変換する", () => {
        const e = parseMusicEmbed("https://music.apple.com/jp/album/foo/123456?i=789");
        expect(e?.service).toBe("appleMusic");
        expect(e?.embedUrl).toBe("https://embed.music.apple.com/jp/album/foo/123456?i=789");
    });

    it("Apple Music の song パスにも対応する", () => {
        const e = parseMusicEmbed("https://music.apple.com/us/song/foo/1555");
        expect(e?.service).toBe("appleMusic");
    });

    it("Apple Music でも不正なパスは null", () => {
        expect(parseMusicEmbed("https://music.apple.com/browse")).toBeNull();
    });

    it("非対応・不正なURLは null", () => {
        expect(parseMusicEmbed("")).toBeNull();
        expect(parseMusicEmbed("not a url")).toBeNull();
        expect(parseMusicEmbed("https://example.com/track/abc")).toBeNull();
        // javascript: などの危険なスキームは拒否
        expect(parseMusicEmbed("javascript:alert(1)")).toBeNull();
        // YouTube だが ID が不正
        expect(parseMusicEmbed("https://youtu.be/!!!")).toBeNull();
    });

    it("musicServiceLabel が表示名を返す", () => {
        expect(musicServiceLabel("spotify")).toBe("Spotify");
        expect(musicServiceLabel("youtube")).toBe("YouTube");
        expect(musicServiceLabel("appleMusic")).toBe("Apple Music");
    });
});
