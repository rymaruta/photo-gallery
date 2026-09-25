/**
 * **iPhone の動画が HEVC（H.265）か。**
 *
 * iPhone の既定（「設定」→「カメラ」→「フォーマット」→「高効率」）は HEVC。
 * そのまま配ると、HEVC を再生できない環境（Firefox・古い Android・一部の
 * Windows の Chrome）では動画が再生されず、ストーリーは黙って次へ送られる
 * （docs/ios-bug-audit-2026-09-25.md #43）。ブラウザの中で H.264 に作り直す
 * 手段は無いので、選んだ時点で投稿した人に知らせる。
 *
 * 見分け方: MP4 / MOV の最上位の箱をたどって `moov`（形式の情報）だけを読み、
 * その中の `stsd` に並ぶ4文字の印 `hvc1` / `hev1`（HEVC）を探す。圧縮データ
 * （`mdat`）は読まない——偶然同じ4バイトが並んでいても取り違えない。
 * `moov` は先頭にも末尾にも置かれうる。読めなければ false
 * （知らせないだけで、投稿は止めない）。
 */
/** moov がこれより大きければ読まない（普通は数十KB〜数MB） */
const MAX_MOOV_BYTES = 16 * 1024 * 1024;

export function containsHevcTag(buf: Uint8Array): boolean {
    for (let i = 0; i + 4 <= buf.length; i++) {
        if (buf[i] !== 0x68) continue; // 'h'
        const a = buf[i + 1], b = buf[i + 2], c = buf[i + 3];
        // "hvc1" / "hev1"
        if ((a === 0x76 && b === 0x63 && c === 0x31) || (a === 0x65 && b === 0x76 && c === 0x31)) return true;
    }
    return false;
}

export async function isHevcVideo(file: Blob): Promise<boolean> {
    try {
        let offset = 0;
        for (let n = 0; n < 64 && offset + 8 <= file.size; n++) {
            const h = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
            let size = h.getUint32(0);
            const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
            let header = 8;
            if (size === 1) {
                if (h.byteLength < 16) return false;
                const big = h.getBigUint64(8);
                if (big > BigInt(Number.MAX_SAFE_INTEGER)) return false;
                size = Number(big);
                header = 16;
            } else if (size === 0) {
                size = file.size - offset; // 末尾まで
            }
            if (size < header) return false; // 壊れている
            if (type === "moov") {
                if (size > MAX_MOOV_BYTES) return false;
                return containsHevcTag(new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()));
            }
            offset += size;
        }
        return false;
    } catch {
        return false;
    }
}
