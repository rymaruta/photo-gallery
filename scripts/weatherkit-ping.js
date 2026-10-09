#!/usr/bin/env node
/**
 * WeatherKit が本当に答えるかを1回だけ確かめる（読み取りのみ・2026-10-09）。
 * SSM の鍵（/journey-photo/<stage>/weatherkit/*）で JWT を作り、東京駅の予報を1回読む。
 * **鍵・トークン・予報の中身はログに出さない**（状態と、雲の高さごとの量の有無だけ）。
 */
const crypto = require("node:crypto");
const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");

const STAGE = process.env.WK_STAGE || "prod";
const TEAM_ID = "5428GX5UM8";
const SERVICE_ID = "com.journeyphoto.JourneyPhoto";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function main() {
    const base = `/journey-photo/${STAGE}/weatherkit`;
    const ssm = new SSMClient({ region: "ap-northeast-1" });
    const out = await ssm.send(new GetParametersCommand({ Names: [`${base}/key-id`, `${base}/private-key`], WithDecryption: true }));
    const get = (n) => out.Parameters?.find((p) => p.Name === n)?.Value ?? "";
    const keyId = get(`${base}/key-id`), privateKey = get(`${base}/private-key`);
    console.log(`SSM: key-id ${keyId ? keyId.length + " 文字" : "無し"}・private-key ${privateKey ? "あり" : "無し"}`);
    if (!keyId || !privateKey) process.exit(1);

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", kid: keyId, id: `${TEAM_ID}.${SERVICE_ID}` };
    const payload = { iss: TEAM_ID, iat: now, exp: now + 600, sub: SERVICE_ID };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const sig = crypto.sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
    const jwt = `${input}.${b64url(sig)}`;

    const url = "https://weatherkit.apple.com/api/v1/weather/ja/35.681/139.767?dataSets=forecastDaily,forecastHourly&timezone=Asia/Tokyo";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    console.log(`WeatherKit: HTTP ${res.status}`);
    if (!res.ok) { console.log((await res.text()).slice(0, 200)); process.exit(1); }
    const body = await res.json();
    const hours = body.forecastHourly?.hours ?? [];
    const first = hours[0] ?? {};
    console.log(`時間ごとの予報: ${hours.length} 件・日ごと: ${body.forecastDaily?.days?.length ?? 0} 件`);
    for (const k of ["cloudCover", "cloudCoverLowAltPct", "cloudCoverMidAltPct", "cloudCoverHighAltPct", "precipitationChance"]) {
        console.log(`  ${k}: ${k in first ? "あり" : "無し"}`);
    }
}
main().catch((e) => { console.error(`失敗: ${e.name}: ${e.message}`); process.exit(1); });
