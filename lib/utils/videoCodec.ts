import { readBox, topLevelBoxes } from "./video";

/**
 * **iPhone の動画が HEVC（H.265）か。**
 *
 * iPhone の既定（「設定」→「カメラ」→「フォーマット」→「高効率」）は HEVC。
 * そのまま配ると、HEVC を再生できない環境（Firefox・古い Android・一部の
 * Windows の Chrome）では動画が再生されず、ストーリーは黙って次へ送られる
 * （docs/ios-bug-audit-2026-09-25.md #43）。ブラウザの中で H.264 に作り直す
 * 手段は無いので、選んだ時点で投稿した人に知らせる。
 *
 * 見分け方: `moov/trak/mdia/minf/stbl/stsd` まで箱をたどり、並んでいる
 * 形式の箱の種別が `hvc1` / `hev1` かを見る。**`moov` 全体を文字列として
 * 探さない**——`stco`/`stsz` の数値に同じ4バイトが偶然並ぶことがある
 * （`video.ts` が `moov` を丸ごと探さない理由と同じ）。箱の読み方は
 * `video.ts` の `readBox` / `topLevelBoxes` を使う（二重に書かない）。
 * 読めなければ false（知らせないだけで、投稿は止めない）。
 */

/** moov がこれより大きければ読まない（普通は数十KB〜数MB） */
const MAX_MOOV_BYTES = 16 * 1024 * 1024;
const PATH = ["trak", "mdia", "minf", "stbl", "stsd"] as const;

/** `moov` の中身（ファイル上の `base` から始まる）で、stsd の形式に HEVC があるか */
export function moovHasHevc(view: DataView, base: number, start: number, end: number): boolean {
    const walk = (from: number, to: number, depth: number): boolean => {
        let off = from;
        while (off < to) {
            const box = readBox(view, off, to, base);
            if (!box) return false;
            if (box.type === PATH[depth]) {
                const inner = box.start + box.headerSize;
                if (box.type === "stsd") {
                    // 版と旗（4バイト）＋ 個数（4バイト）のあとに形式の箱が並ぶ
                    let e = inner + 8;
                    while (e < box.boxEnd) {
                        const entry = readBox(view, e, box.boxEnd, base);
                        if (!entry) break;
                        if (entry.type === "hvc1" || entry.type === "hev1") return true;
                        e = entry.boxEnd;
                    }
                } else if (walk(inner, box.boxEnd, depth + 1)) {
                    return true;
                }
            }
            off = box.boxEnd;
        }
        return false;
    };
    return walk(start, end, 0);
}

export async function isHevcVideo(file: Blob): Promise<boolean> {
    try {
        const boxes = await topLevelBoxes(file);
        const moov = boxes?.find((b) => b.type === "moov");
        if (!moov || moov.boxEnd - moov.start > MAX_MOOV_BYTES) return false;
        const view = new DataView(await file.slice(moov.start, moov.boxEnd).arrayBuffer());
        return moovHasHevc(view, moov.start, moov.start + moov.headerSize, moov.boxEnd);
    } catch {
        return false;
    }
}
