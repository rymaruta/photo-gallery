#!/usr/bin/env node
/**
 * FREE local screenshot path when GitHub-hosted Actions cannot start a job.
 *
 * Uses the REAL Next.js MapPageClient, temporary CI-style fixtures and public
 * GSI tiles. The fixtures are never committed to published app content.
 *
 * From repository root, on a computer with internet:
 *   npm ci
 *   npx playwright install chromium
 *   node scripts/capture-free-imagery-local.mjs
 *
 * NO paid API keys, GitHub Actions, account payment or deployed site needed.
 * Screenshots land in a temporary folder printed at the end.
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const routes = [
  { slug: "japan", label: "Japan", hash: "#15/35.503/138.756",
    source: "/xyz/seamlessphoto/", description: "GSI zoom-14+ real Japanese orthophoto",
    pins: [
      ["proof-fuji-a", "河口湖周辺A（検証用）", "山梨県", 35.502, 138.755],
      ["proof-fuji-b", "河口湖周辺B（検証用）", "山梨県", 35.503, 138.759],
      ["proof-fuji-c", "河口湖周辺C（検証用）", "山梨県", 35.504, 138.758],
    ] },
  { slug: "overseas", label: "Overseas", hash: "#7/36.46/25.375",
    source: "/xyz/modis/", description: "GSI low-resolution worldwide MODIS image, NOT a high-detail orthophoto",
    pins: [
      ["proof-santorini", "サントリーニ島（検証用）", "ギリシャ", 36.4615, 25.375],
      ["proof-naxos", "ナクソス島（検証用）", "ギリシャ", 37.105, 25.376],
      ["proof-athens", "アテネ（検証用）", "ギリシャ", 37.98, 23.72],
    ] },
];
const port = 3037;
const output = await mkdtemp(join(tmpdir(), "journey-map-real-imagery-"));
const created = [];
let server;
let browser;
let log = "";

try {
  // Leave any existing developer files untouched. The proof route exists only
  // while this command is running and is never a published official spot.
  for (const route of routes) {
    const dir = resolve(root, "app/map/free-proof-" + route.slug);
    try {
      await stat(dir);
      throw Error("Refusing to overwrite pre-existing route: " + dir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(dir, { recursive: false });
    created.push(dir);
    await writeFile(join(dir, "page.tsx"), 'import Proof from "./Proof";\nexport default function Page() { return <Proof />; }\n');
    const fixture = route.pins.map(([slug, name, region, lat, lng]) =>
      ({ slug, name, region, lat, lng, cover: null, summary: "CI/ローカル表示の検証用。公開済みスポットではありません。" }));
    await writeFile(join(dir, "Proof.tsx"),
      '"use client";\nimport React from "react";\nimport MapPageClient from "../MapPageClient";\n'
      + 'import type { SpotPin } from "../../../lib/data/spotLink";\n'
      + "const SPOTS: SpotPin[] = " + JSON.stringify(fixture) + ";\n"
      + 'export default function Proof() { return <><p className="px-4 pt-2 text-xs text-link">LOCAL TEST DATA / NOT PUBLISHED</p><MapPageClient spots={SPOTS} /></>; }\n'
    );
  }

  server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_JOURNEY_MAPTILER_KEY: "" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (b) => { log = (log + b.toString()).slice(-8000); });
  server.stderr.on("data", (b) => { log = (log + b.toString()).slice(-8000); });
  const url = "http://127.0.0.1:" + port;
  let started = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error("Next.js exited: " + log);
    try { const res = await fetch(url + "/map/free-proof-japan"); if (res.ok) { started = true; break; } } catch { /* still starting */ }
    await new Promise((ok) => setTimeout(ok, 900));
  }
  if (!started) throw Error("Next.js did not start: " + log);

  browser = await chromium.launch({ headless: true });
  for (const route of routes) {
    for (const [device, width, height] of [["mobile", 390, 844], ["desktop", 1280, 800]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const tiles = [];
      const errors = [];
      page.on("response", (response) => {
        if (response.url().includes("cyberjapandata.gsi.go.jp" + route.source) && response.status() === 200)
          tiles.push(response.url());
      });
      page.on("pageerror", (error) => errors.push(String(error)));
      try {
        await page.goto(url + "/map/free-proof-" + route.slug + route.hash, {
          waitUntil: "domcontentloaded", timeout: 120000,
        });
        await page.locator('[data-basemap="free-imagery-ready"]').waitFor({ timeout: 90000 });
        await page.waitForTimeout(4500);
        if (!tiles.length) throw Error(route.description + " tiles never returned HTTP 200.");
        if (errors.length) throw Error("Browser errors: " + errors.slice(0, 5).join("; "));
        const stem = route.slug + "-" + device;
        await page.screenshot({ path: join(output, stem + "-real-imagery.png"), fullPage: true });
        const pin = page.locator(".spot-map-pin-icon").first();
        if (await pin.count()) {
          await pin.click({ timeout: 12000 });
          await page.screenshot({ path: join(output, stem + "-selected-real-imagery.png"), fullPage: true });
        }
        console.log(stem + ": actual " + route.description + ", " + tiles.length + " image tile HTTP 200; screenshots saved.");
      } finally {
        await page.close();
      }
    }
  }
  console.log("Verified real-app screenshots:", output);
} catch (error) {
  console.error("Screenshot proof FAILED:", error);
  console.error("No satellite/aerial screenshot should be claimed unless image tiles loaded successfully.");
  console.error(log.slice(-3500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    try {
      if (process.platform === "win32") server.kill("SIGTERM");
      else process.kill(-server.pid, "SIGTERM");
    } catch { /* already closed */ }
  }
  for (const dir of created) await rm(dir, { recursive: true, force: true }).catch(() => {});
}
