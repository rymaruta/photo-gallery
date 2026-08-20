import { describe, it, expect } from "vitest";
import { safeSongPreviewUrl, safeSongArtworkUrl, safeSongTrackUrl } from "../mediaHosts";

// 曲の音源・アートワークは「アプリ内の曲検索が返した値」を保存して各画面が
// 読み込む作り。検証は https かどうかだけで、コメントに書いてある
// 「Apple のホストのみ許可」が実装されていなかった。
//
// 通ると何が起きるか:
//   - previewUrl は StoryViewer が <audio preload="auto"> で**先読み**する
//   - artwork は MiniPlayer / MusicCard が <img> で読み込む
//   - ストーリーはログイン中の全員のトレイに出る
//   - プロフィールは未認証でも読める
// 任意のURLを1回仕込むだけで、開いた人の IP・User-Agent・時刻を集められる。
// 写真の thumbUrl で塞いだのと同じ穴が、曲まわりの3フィールドに残っていた。

describe("safeSongPreviewUrl", () => {
    it("Apple の配信ホストは通す", () => {
        expect(safeSongPreviewUrl("https://audio-ssl.itunes.apple.com/x/y.m4a"))
            .toBe("https://audio-ssl.itunes.apple.com/x/y.m4a");
        expect(safeSongPreviewUrl("https://audio-ssl.mzstatic.com/a.m4a")).toBeTruthy();
    });

    it("外部のホストは通さない", () => {
        expect(safeSongPreviewUrl("https://attacker.tld/beacon.mp3")).toBeUndefined();
    });

    it("末尾一致だけの偽ホストは通さない", () => {
        // "mzstatic.com" で終わるかどうかだけを見ると、この形が通ってしまう
        expect(safeSongPreviewUrl("https://evil-mzstatic.com/a.m4a")).toBeUndefined();
        expect(safeSongPreviewUrl("https://mzstatic.com.attacker.tld/a.m4a")).toBeUndefined();
    });

    it("http は通さない", () => {
        expect(safeSongPreviewUrl("http://audio-ssl.itunes.apple.com/a.m4a")).toBeUndefined();
    });

    it("ホスト部分に見せかけた小細工も通さない", () => {
        expect(safeSongPreviewUrl("https://attacker.tld/?x=audio-ssl.itunes.apple.com")).toBeUndefined();
        expect(safeSongPreviewUrl("https://attacker.tld#apple.com")).toBeUndefined();
        expect(safeSongPreviewUrl("https://user@attacker.tld/a.m4a")).toBeUndefined();
    });

    it("URL でない値・空・非文字列は undefined", () => {
        for (const v of ["", "   ", "not a url", undefined, null, 123, {}]) {
            expect(safeSongPreviewUrl(v)).toBeUndefined();
        }
    });

    it("大文字のホストでも判定できる", () => {
        expect(safeSongPreviewUrl("https://AUDIO-SSL.ITUNES.APPLE.COM/a.m4a")).toBeTruthy();
    });

    it("用途の違うApple ホストは通さない", () => {
        // 曲ページのホストを音源として入れる意味は無い。
        // まとめて apple.com を許すと、こうした組み合わせが全部通る。
        expect(safeSongPreviewUrl("https://music.apple.com/jp/album/x/1")).toBeUndefined();
    });

    it("長すぎる値は切り詰めてから判定する（結果的に弾かれる）", () => {
        const long = `https://audio-ssl.itunes.apple.com/${"a".repeat(600)}.m4a`;
        const out = safeSongPreviewUrl(long);
        // 切り詰めても URL として成立するので通るが、長さは上限まで
        expect(out && out.length).toBeLessThanOrEqual(500);
    });
});

describe("safeSongArtworkUrl", () => {
    it("Apple の画像ホストは通す", () => {
        expect(safeSongArtworkUrl("https://is1-ssl.mzstatic.com/image/a.jpg")).toBeTruthy();
    });
    it("外部は通さない", () => {
        expect(safeSongArtworkUrl("https://attacker.tld/px.gif")).toBeUndefined();
    });
    it("音源のホストを流用させない", () => {
        // アートワークに音源ホストを入れる意味は無い。許可は用途ごとに分ける
        expect(safeSongArtworkUrl("https://audio-ssl.itunes.apple.com/a.m4a")).toBeUndefined();
    });
});

describe("safeSongTrackUrl", () => {
    it("曲ページのホストは通す", () => {
        expect(safeSongTrackUrl("https://music.apple.com/jp/album/x/1")).toBeTruthy();
        expect(safeSongTrackUrl("https://itunes.apple.com/jp/album/x/1")).toBeTruthy();
    });
    it("外部は通さない", () => {
        expect(safeSongTrackUrl("https://attacker.tld/track")).toBeUndefined();
    });
});
