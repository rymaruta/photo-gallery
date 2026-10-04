#!/usr/bin/env python3
"""写真が1枚も無い撮影スポットについて、自由に使える写真の候補を外部から探す（読むだけ）。

源:
  1. Wikidata: 項目の代表写真（P18）・Commons の分類（P373）・座標（P625）
  2. Commons: 分類の中のファイル / 2km の位置検索（名前が当たるもの）/ 名前での全文検索
  3. Openverse: Flickr などの CC 写真の横断検索（名前・英語名）

ライセンスの決まりは作例（docs/spot-samples-commons.md）と同じ:
  採る: CC0 / パブリックドメイン（PD-US 系を除く）/ CC BY / CC BY-SA
  落とす: NC・ND・GFDL のみ・作者が名前でないもの（CC BY 系）
結果は results/<slug>.json に1か所ずつ書く（途中で止めても続きから流せる）。
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request

UA = "JourneyPhotoSpotResearch/1.0 (https://journey-photo.com; research for free-licensed spot photos)"
OUT = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(OUT, exist_ok=True)
last_call = {}

def get(url, host_gap=2.5, tries=6):
    host = urllib.parse.urlparse(url).netloc
    for i in range(tries):
        wait = host_gap - (time.time() - last_call.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        last_call[host] = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 503, 502, 500):
                ra = e.headers.get("Retry-After")
                time.sleep(min(120, int(ra) if ra and ra.isdigit() else 15 * (i + 1)))
                continue
            return {"_error": e.code}
        except Exception as e:  # 通信の揺れ
            time.sleep(10 * (i + 1))
    return {"_error": "gave-up"}

def km(a, b):
    if not a or not b:
        return None
    R = 6371
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

PLACEHOLDER = re.compile(r"own work|投稿者自身|unknown|不明|推定|please|appreciate|\(UTC\)", re.I)

def license_ok(short, author, template=""):
    s = (short or "").strip()
    low = s.lower()
    if not s:
        return False, "no-license"
    if "nc" in re.split(r"[\s\-/]+", low) or "-nc" in low or " nc" in low or "nd" in re.split(r"[\s\-/]+", low) or "-nd" in low:
        return False, "nc-nd"
    if "pd-us" in (template or "").lower() or low.startswith("pd-us"):
        return False, "pd-us"
    is_pd = low in ("public domain", "cc0", "cc0 1.0", "pdm", "pdm 1.0") or low.startswith("pd") or low.startswith("cc0") or "public domain" in low
    is_by = low.startswith("cc by") or low.startswith("cc-by") or low in ("by", "by-sa")
    if not (is_pd or is_by):
        return False, "other:" + s[:20]
    if is_by:
        a = (author or "").strip()
        if not a or PLACEHOLDER.search(a) or len(a) > 80:
            return False, "no-author"
    return True, "ok"

def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()

def tokens(t):
    toks = set()
    for n in [t["name"], t.get("nameEn")] + list(t.get("aliases") or []):
        if not n:
            continue
        n = n.strip()
        toks.add(n.lower())
        # 「喜多方 蔵の町」→ 喜多方・蔵の町、英語は 4字以上の語
        for w in re.split(r"[\s・（）()／/,、]+", n):
            w = w.strip().lower()
            if len(w) >= 2 and not re.fullmatch(r"[a-z]{1,3}", w) and w not in ("the", "park", "temple", "shrine", "river", "mount", "falls", "lake", "bridge", "island", "castle", "station", "city"):
                toks.add(w)
    return {x for x in toks if x}

def named(text, toks):
    low = (text or "").lower().replace("_", " ")
    return any(tok in low for tok in toks)

def commons_info(titles):
    out = []
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        q = urllib.parse.urlencode({
            "action": "query", "format": "json", "maxlag": 5, "prop": "imageinfo",
            "iiprop": "url|size|extmetadata|mime", "iiurlwidth": 1280,
            "titles": "|".join(chunk)})
        d = get("https://commons.wikimedia.org/w/api.php?" + q)
        for p in (d.get("query", {}).get("pages", {}) or {}).values():
            ii = (p.get("imageinfo") or [{}])[0]
            md = ii.get("extmetadata") or {}
            mime = ii.get("mime", "")
            if not mime.startswith("image/") or mime in ("image/svg+xml", "image/gif"):
                continue
            short = strip_html((md.get("LicenseShortName") or {}).get("value"))
            author = strip_html((md.get("Artist") or {}).get("value"))
            tmpl = strip_html((md.get("License") or {}).get("value"))
            ok, why = license_ok(short, author, tmpl)
            gps = None
            if md.get("GPSLatitude") and md.get("GPSLongitude"):
                try:
                    gps = (float(md["GPSLatitude"]["value"]), float(md["GPSLongitude"]["value"]))
                except Exception:
                    pass
            out.append({
                "title": p.get("title"), "pageUrl": ii.get("descriptionurl"), "thumbUrl": ii.get("thumburl"),
                "width": ii.get("width"), "height": ii.get("height"), "license": short, "author": author[:120],
                "ok": ok, "why": why, "desc": strip_html((md.get("ImageDescription") or {}).get("value"))[:200],
                "gps": gps,
            })
    return out

def wikidata(t):
    qid = t.get("wikidata")
    if not qid:
        for lang, name in (("ja", t["name"]), ("en", t.get("nameEn"))):
            if not name:
                continue
            d = get("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
                "action": "wbsearchentities", "search": name, "language": lang, "limit": 5, "format": "json"}), host_gap=1.0)
            cands = [x["id"] for x in d.get("search", [])]
            if not cands:
                continue
            e = get("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
                "action": "wbgetentities", "ids": "|".join(cands), "props": "claims", "format": "json"}), host_gap=1.0)
            best = None
            for cid in cands:
                cl = e.get("entities", {}).get(cid, {}).get("claims", {})
                co = cl.get("P625", [{}])[0].get("mainsnak", {}).get("datavalue", {}).get("value")
                if co and t.get("coords"):
                    dist = km((co["latitude"], co["longitude"]), (t["coords"]["lat"], t["coords"]["lng"]))
                    if dist is not None and dist <= 15:
                        best = cid
                        break
            if best:
                qid = best
                break
    if not qid:
        return None
    e = get("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
        "action": "wbgetentities", "ids": qid, "props": "claims", "format": "json"}), host_gap=1.0)
    cl = e.get("entities", {}).get(qid, {}).get("claims", {})
    def val(p):
        return [c.get("mainsnak", {}).get("datavalue", {}).get("value") for c in cl.get(p, []) if c.get("mainsnak", {}).get("datavalue")]
    co = (val("P625") or [None])[0]
    return {"qid": qid, "p18": val("P18"), "p373": (val("P373") or [None])[0],
            "coords": (co["latitude"], co["longitude"]) if co else None, "matchedBy": "ledger" if t.get("wikidata") else "search"}

def commons_category_files(cat, limit=60):
    d = get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "maxlag": 5, "list": "categorymembers", "cmtitle": "Category:" + cat,
        "cmtype": "file", "cmlimit": limit}))
    return [m["title"] for m in d.get("query", {}).get("categorymembers", [])]

def commons_geo(lat, lng, radius=2000, limit=100):
    d = get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "maxlag": 5, "list": "geosearch", "gscoord": f"{lat}|{lng}",
        "gsradius": radius, "gslimit": limit, "gsnamespace": 6}))
    return [(g["title"], g.get("dist")) for g in d.get("query", {}).get("geosearch", [])]

def commons_search(q, limit=20):
    d = get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "maxlag": 5, "list": "search", "srsearch": q,
        "srnamespace": 6, "srlimit": limit}))
    return [s["title"] for s in d.get("query", {}).get("search", [])]

def openverse(q):
    d = get("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode({
        "q": q, "license": "by,by-sa,cc0,pdm", "page_size": 20, "mature": "false"}), host_gap=4.0)
    out = []
    for r in d.get("results", []) or []:
        lic = (r.get("license") or "").lower()
        short = {"by": "CC BY", "by-sa": "CC BY-SA", "cc0": "CC0", "pdm": "Public domain"}.get(lic, lic)
        if r.get("license_version") and short.startswith("CC BY"):
            short += " " + r["license_version"]
        ok, why = license_ok(short, r.get("creator"))
        out.append({"title": r.get("title"), "source": r.get("source"), "provider": r.get("provider"),
                    "pageUrl": r.get("foreign_landing_url"), "url": r.get("url"), "creator": r.get("creator"),
                    "license": short, "width": r.get("width"), "height": r.get("height"), "ok": ok, "why": why,
                    "tags": [x.get("name") for x in (r.get("tags") or [])][:12]})
    return out if "_error" not in d else [{"_error": d["_error"]}]

def research(t):
    toks = tokens(t)
    res = {"slug": t["slug"], "name": t["name"], "nameEn": t.get("nameEn"), "category": t.get("category"),
           "region": t.get("region"), "coords": t.get("coords"), "tokens": sorted(toks)}
    wd = wikidata(t)
    res["wikidata"] = wd
    pool = {}  # title -> source tags
    def add(title, src):
        pool.setdefault(title, set()).add(src)
    if wd:
        for f in wd.get("p18") or []:
            add("File:" + f, "wikidata-P18")
        if wd.get("p373"):
            for f in commons_category_files(wd["p373"]):
                add(f, "commons-category")
    centers = []
    if t.get("coords"):
        centers.append((t["coords"]["lat"], t["coords"]["lng"]))
    if wd and wd.get("coords") and (not centers or (km(centers[0], wd["coords"]) or 0) > 0.3):
        centers.append(wd["coords"])
    geo_total = 0
    for c in centers:
        for title, dist in commons_geo(c[0], c[1]):
            geo_total += 1
            if named(title, toks):
                add(title, "commons-geo2km-named")
    res["geoFiles2km"] = geo_total
    for q in {t["name"], t.get("nameEn")} - {None}:
        for title in commons_search(q):
            if named(title, toks):
                add(title, "commons-search")
    infos = commons_info(sorted(pool)) if pool else []
    for i in infos:
        i["sources"] = sorted(pool.get(i["title"], []))
        # 名前で拾ったのでない分類の中身は、説明か題に名前があるかも記録
        i["named"] = named((i["title"] or "") + " " + (i.get("desc") or ""), toks)
    res["commons"] = infos
    ov = []
    for q in [t.get("nameEn"), t["name"]]:
        if q:
            ov.extend(openverse(q))
    # Wikimedia 由来は Commons 側で数えるので除く
    seen = set()
    res["openverse"] = []
    for r in ov:
        if "_error" in r:
            res["openverse"].append(r)
            continue
        if r.get("source") == "wikimedia" or r.get("pageUrl") in seen:
            continue
        seen.add(r.get("pageUrl"))
        r["named"] = named((r.get("title") or "") + " " + " ".join(r.get("tags") or []), toks)
        res["openverse"].append(r)
    return res

def main():
    targets = json.load(open(os.path.join(os.path.dirname(__file__), "targets.json")))
    only = sys.argv[1:]  # slug を渡せばそれだけ
    for n, t in enumerate(targets, 1):
        if only and t["slug"] not in only:
            continue
        path = os.path.join(OUT, t["slug"] + ".json")
        if os.path.exists(path) and not only:
            continue
        try:
            r = research(t)
        except Exception as e:
            r = {"slug": t["slug"], "_error": repr(e)}
        json.dump(r, open(path, "w"), ensure_ascii=False, indent=1)
        ok_c = sum(1 for i in r.get("commons", []) if i.get("ok"))
        ok_o = sum(1 for i in r.get("openverse", []) if i.get("ok") and i.get("named"))
        print(f"[{n}/{len(targets)}] {t['slug']} commons-ok={ok_c} openverse-named-ok={ok_o}", flush=True)

if __name__ == "__main__":
    main()
