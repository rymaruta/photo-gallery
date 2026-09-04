"use client";

import { useCallback, useRef, useState } from "react";
import { searchSongs, type SongResult } from "../utils/music";

/**
 * 曲の検索（BGM 選び）。**3画面で同じものを書いていたので1つにまとめた。**
 *
 * ストーリー投稿・写真ページ・プロフィール編集の3か所に、同じ検索と同じ
 * 状態（結果・検索中・失敗）が別々に書かれていた。しかも**世代で追い越しを
 * 捨てる仕掛けはストーリーにしか無く**、残り2つでは遅れて返った古い結果が
 * 新しい結果を上書きしていた（画面には打っていない語の結果が出る）。
 *
 * 複製したまま「3か所とも同じ形か」をソースの綴りで見張ろうとしたが、
 * **`return` を消してコメントだけ残す変異が素通り**した（レビューが実証）。
 * 綴りを見張るより、1つにして振る舞いを確かめる方が確実。
 *
 * ## 世代で捨てる
 *
 * `searchSongs` は `AbortSignal` を受け取れるが、ここでは使っていない
 * ——中断すると「押し直したら前の結果も消える」になり、遅い回線で
 * 画面が空になる時間が伸びる。捨てるのは**着地した結果の採用**だけにする。
 * （Lambda の枠を気にするなら中断の方が良いが、それは別の判断。）
 */
export function useSongSearch() {
    const [results, setResults] = useState<SongResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState(false);
    const gen = useRef(0);

    const search = useCallback(async (raw: string) => {
        const q = raw.trim();
        if (!q) return;
        const my = ++gen.current;
        setSearching(true);
        setError(false);
        try {
            const found = await searchSongs(q);
            if (my !== gen.current) return;   // もっと新しい検索が走っている
            setResults(found);
        } catch {
            if (my === gen.current) {
                setResults([]);
                setError(true);   // 0件と同じ無反応にしない（SW-b6）
            }
        } finally {
            // **終了処理でも世代を見る。** 見ないと、古い応答の後始末が
            // 「検索中」の表示を消して、走っている新しい検索が無反応に見える
            if (my === gen.current) setSearching(false);
        }
    }, []);

    /**
     * 結果を捨てる（ピッカーを閉じるときなど）。
     *
     * **世代も進める。** 進めないと、閉じたあとに届いた応答が結果を埋め、
     * 開き直したときに前回の検索結果が一瞬出る。
     */
    const clear = useCallback(() => {
        gen.current++;
        setResults([]);
        setError(false);
        setSearching(false);
    }, []);

    return { results, searching, error, search, clear };
}
