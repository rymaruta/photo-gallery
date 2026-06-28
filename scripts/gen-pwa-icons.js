const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const out = "/home/user/photo-gallery/public";

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#000000"/>
  <rect x="${size * 0.1}" y="${size * 0.1}" width="${size * 0.8}" height="${size * 0.8}" rx="${size * 0.18}" fill="none" stroke="#ffffff" stroke-width="${size * 0.02}"/>
  <text x="50%" y="50%" font-family="Helvetica, Arial, sans-serif" font-size="${size * 0.38}" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">JP</text>
</svg>`;

async function gen(size, name) {
  const buf = Buffer.from(svg(size));
  await sharp(buf).png().toFile(path.join(out, name));
  console.log(`wrote ${name} (${size}x${size})`);
}

(async () => {
  await gen(192, "icon-192.png");
  await gen(512, "icon-512.png");
  // maskable: add a safe zone margin
  const maskable = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#000000"/>
  <text x="50%" y="50%" font-family="Helvetica, Arial, sans-serif" font-size="${size * 0.28}" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">JP</text>
</svg>`;
  await sharp(Buffer.from(maskable(512))).png().toFile(path.join(out, "icon-maskable-512.png"));
  console.log("done");
})();
