#!/usr/bin/env node
/**
 * サイトのアイコン一式を1枚の元絵から作る。
 *
 *   node scripts/generate-icons.mjs [元絵のPNG]   （既定: scripts/icon-source/aperture.png）
 *
 * 出す先（すべて上書き）:
 *   app/favicon.ico              16 / 32 / 48 の PNG を ICO に束ねる（検索結果の favicon。
 *                                Google は 48 の倍数の正方形を求める）
 *   public/icon-192.png          ホーム画面・apple-touch-icon（`app/layout.tsx`）
 *   public/icon-512.png          同 512（`manifest.webmanifest` の purpose: any）
 *   public/icon-maskable-512.png OS が丸や角丸に切り抜く側。**枠は描かない**——切り抜きで
 *                                枠だけ欠ける。安全域（中央 80%）に絵を収める
 *
 * 見た目は前のアイコン（JP の文字）の**白い外枠・黒地**をそのまま引き継ぐ
 * （owner:「外枠のしろい」）。元絵は黒地に白いアパーチャで、余白は黒。
 */
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] ?? path.join(root, "scripts/icon-source/aperture.png");

/** 元絵の白い部分の外接矩形（黒地の余白を落として、絵の大きさを揃えるため） */
async function whiteBBox(file) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    let minx = info.width, miny = info.height, maxx = -1, maxy = -1;
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * info.channels] > 128) {
                if (x < minx) minx = x; if (x > maxx) maxx = x;
                if (y < miny) miny = y; if (y > maxy) maxy = y;
            }
        }
    }
    if (maxx < 0) throw new Error("元絵に白い部分が無い");
    return { left: minx, top: miny, width: maxx - minx + 1, height: maxy - miny + 1 };
}

/** 絵を正方形に切り出して `size` px に（縦横比は保つ・黒で埋める） */
async function artwork(size) {
    const b = await whiteBBox(src);
    const side = Math.max(b.width, b.height);
    const meta = await sharp(src).metadata();
    const left = Math.max(0, Math.min(meta.width - side, b.left - Math.floor((side - b.width) / 2)));
    const top = Math.max(0, Math.min(meta.height - side, b.top - Math.floor((side - b.height) / 2)));
    return sharp(src).extract({ left, top, width: side, height: side })
        .resize(size, size, { fit: "contain", background: "#000" }).png().toBuffer();
}

/** 黒地 512 ＋（枠あり／なし）＋ 絵を中央に */
async function icon512({ frame }) {
    // 枠の寸法は前のアイコンを実測したもの（線の外側 46px・太さ 10px・角丸 ≒ 96px）
    const frameSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
           <rect x="51" y="51" width="410" height="410" rx="96" ry="96" fill="none" stroke="#fff" stroke-width="10"/>
         </svg>`,
    );
    const art = await artwork(frame ? 272 : 300);
    const layers = [{ input: art, gravity: "centre" }];
    if (frame) layers.unshift({ input: frameSvg });
    return sharp({ create: { width: 512, height: 512, channels: 4, background: "#000" } })
        .composite(layers).png().toBuffer();
}

/** PNG を ICO の器に束ねる（Vista 以降・全モダンブラウザが読む形式） */
function ico(pngs) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
    const dir = []; let offset = 6 + 16 * pngs.length; const bodies = [];
    for (const { size, buf } of pngs) {
        const e = Buffer.alloc(16);
        e.writeUInt8(size === 256 ? 0 : size, 0); e.writeUInt8(size === 256 ? 0 : size, 1);
        e.writeUInt8(0, 2); e.writeUInt8(0, 3);
        e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
        e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
        dir.push(e); bodies.push(buf); offset += buf.length;
    }
    return Buffer.concat([header, ...dir, ...bodies]);
}

const any512 = await icon512({ frame: true });
const maskable512 = await icon512({ frame: false });
const at = (size) => sharp(any512).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();

await writeFile(path.join(root, "public/icon-512.png"), any512);
await writeFile(path.join(root, "public/icon-maskable-512.png"), maskable512);
await writeFile(path.join(root, "public/icon-192.png"), await at(192));
await writeFile(path.join(root, "app/favicon.ico"), ico([
    { size: 16, buf: await at(16) }, { size: 32, buf: await at(32) }, { size: 48, buf: await at(48) },
]));
console.log("[icons] wrote favicon.ico (16/32/48), icon-192.png, icon-512.png, icon-maskable-512.png from", path.relative(root, src));
