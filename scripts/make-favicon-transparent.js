/**
 * PNG の黒丸の外側＋白枠を透過し、favicon.png を生成する。
 * favicon1 指定時は favicon.svg（PNG 埋め込み）も作成する。
 * 使い方:
 *   node scripts/make-favicon-transparent.js           → public/SiteIcon.png を読んで public/favicon.png を出力
 *   node scripts/make-favicon-transparent.js favicon1  → public/source/favicon1.png を読んで public/favicon.png と public/favicon.svg を出力
 */
const path = require("path");
const fs = require("fs");

const isFavicon1 = process.argv[2] === "favicon1";
const inputName = isFavicon1 ? "favicon1.png" : "SiteIcon.png";
const inputPath = path.join(
  process.cwd(),
  "public",
  isFavicon1 ? path.join("source", inputName) : inputName
);
const outputPngPath = path.join(process.cwd(), "public", "favicon.png");
const outputSvgPath = path.join(process.cwd(), "public", "favicon.svg");

/** 白枠・縁の残りを透過するため、円の半径を内側に縮める割合（0〜1） */
const RADIUS_INSET = 0.15;
/** favicon1 用：白外枠を全部消すため、さらに内側に縮める */
const RADIUS_INSET_FAVICON1 = 0.36;
/** 縁から何ピクセル内側まで「白っぽいピクセル」を透過するか */
const EDGE_BAND_PX = 4;
const EDGE_BAND_PX_FAVICON1 = 22;
/** この明度以上を「白」とみなして透過する（0〜765）。薄い白輪も消すため低め */
const WHITE_THRESHOLD = 400;
const WHITE_THRESHOLD_FAVICON1 = 100;
/** アイコンを大きく見せるため、透明でない部分でクロップする（favicon1 用） */
const CROP_TO_CONTENT_FAVICON1 = true;
const CROP_MARGIN = 0;

async function main() {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    console.error(
      "[make-favicon-transparent] sharp がインストールされていません。\n  npm install --save-dev sharp を実行してください。"
    );
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error("[make-favicon-transparent] " + inputName + " が見つかりません。");
    process.exit(1);
  }

  const image = sharp(inputPath);
  const raw = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const stride = info.channels;

  const cx = info.width / 2;
  const cy = info.height / 2;
  const maxR = Math.min(info.width, info.height) / 2;
  const radiusInset = isFavicon1 ? RADIUS_INSET_FAVICON1 : RADIUS_INSET;
  const edgeBand = isFavicon1 ? EDGE_BAND_PX_FAVICON1 : EDGE_BAND_PX;
  const whiteThreshold = isFavicon1 ? WHITE_THRESHOLD_FAVICON1 : WHITE_THRESHOLD;
  const r = maxR * (1 - radiusInset);
  const rInnerSq = Math.max(0, r - edgeBand) ** 2;
  const rSq = r * r;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dSq = dx * dx + dy * dy;
      const i = (y * info.width + x) * stride;

      if (dSq > rSq) {
        data[i + 3] = 0; // 円の外は透過
      } else if (dSq > rInnerSq) {
        // 縁付近の帯：白っぽいピクセルも透過（細かい白線・ジャギー除去）
        const brightness = data[i] + data[i + 1] + data[i + 2];
        if (brightness >= whiteThreshold) {
          data[i + 3] = 0;
        }
      }
    }
  }

  let outW = info.width;
  let outH = info.height;
  let outData = data;

  if (isFavicon1 && CROP_TO_CONTENT_FAVICON1) {
    let minX = info.width;
    let minY = info.height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * stride;
        if (data[i + 3] > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX <= maxX && minY <= maxY) {
      minX = Math.max(0, minX - CROP_MARGIN);
      minY = Math.max(0, minY - CROP_MARGIN);
      maxX = Math.min(info.width - 1, maxX + CROP_MARGIN);
      maxY = Math.min(info.height - 1, maxY + CROP_MARGIN);
      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;
      const cropSize = cropW * cropH * stride;
      const cropData = Buffer.alloc(cropSize);
      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          const srcI = ((minY + y) * info.width + (minX + x)) * stride;
          const dstI = (y * cropW + x) * stride;
          for (let c = 0; c < stride; c++) cropData[dstI + c] = data[srcI + c];
        }
      }
      outData = cropData;
      outW = cropW;
      outH = cropH;
    }
  }

  await sharp(outData, {
    raw: {
      width: outW,
      height: outH,
      channels: info.channels,
    },
  })
    .png()
    .toFile(outputPngPath);

  console.log("[make-favicon-transparent] public/favicon.png を生成しました（" + inputName + " の黒丸の外側・白枠を透過）。");

  if (isFavicon1) {
    const pngBuffer = fs.readFileSync(outputPngPath);
    const base64 = pngBuffer.toString("base64");
    const w = outW;
    const h = outH;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' +
      w +
      " " +
      h +
      '"><image width="' +
      w +
      '" height="' +
      h +
      '" xlink:href="data:image/png;base64,' +
      base64 +
      '"/></svg>';
    fs.writeFileSync(outputSvgPath, svg, "utf8");
    console.log("[make-favicon-transparent] public/favicon.svg を生成しました（PNG 埋め込み）。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
