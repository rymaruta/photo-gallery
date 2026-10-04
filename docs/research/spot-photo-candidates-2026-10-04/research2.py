#!/usr/bin/env python3
"""2巡目: 1巡目（research.py）で拾っていない源から、写真の名前を集める。

  A（名前集め・Wikipedia/Wikivoyage だけに問い合わせる。1巡目の Commons と混まない）
     - ja/en Wikipedia の記事（Wikidata のサイトリンク、無ければ名前で検索）に使われているファイル全部
     - ja/en Wikivoyage の記事のファイル
  B（ライセンス確かめ・Commons に問い合わせる。1巡目が終わってから）
     - A のファイルの extmetadata
     - Commons の位置検索を 5km に広げ、名前が当たるもの
     - 別名・都道府県名つきの全文検索
結果は results2/<slug>.json。
  python3 research2.py A   # 名前集め
  python3 research2.py B   # ライセンス確かめ
"""
import json, os, sys, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
import research as R

OUT = os.path.join(os.path.dirname(__file__), "results2")
os.makedirs(OUT, exist_ok=True)
SKIP = ("Commons-logo", "Wikivoyage", "Wikipedia", "Wiki_letter", "Edit-clear", "Question_book", "Ambox",
        "Flag_of", "Emblem_of", "Symbol_of", "Map", "map", "Location", "location", "Locator", "Red_pog", "Pictogram",
        "Japan_", "Disambig", "Icon", "icon", "Logo", "logo", "Crystal_Clear", "Nuvola", "Gnome", "Increase", "Decrease",
        "Steady", "Pencil", "Folder", "Text-x", "OOjs", "Searchtool", "Coat_of_arms", "Seal_of", "Japanese_crest",
        ".svg", ".SVG", ".gif", ".GIF")

def titles_for(host, title):
    d = R.get(f"https://{host}/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "prop": "images", "titles": title, "imlimit": 200, "redirects": 1}), host_gap=1.0)
    out = []
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        for im in p.get("images", []) or []:
            t = im["title"]
            # 日本語版は「ファイル:」で返す
            name = t.split(":", 1)[1]
            if any(s in name for s in SKIP):
                continue
            out.append("File:" + name)
    return out

def search_title(host, q):
    d = R.get(f"https://{host}/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "list": "search", "srsearch": q, "srlimit": 1}), host_gap=1.0)
    hits = d.get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None

def phase_a(t, r1):
    wd = (r1 or {}).get("wikidata") or {}
    links = {}
    if wd.get("qid"):
        e = R.get("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": wd["qid"], "props": "sitelinks", "format": "json"}), host_gap=1.0)
        sl = e.get("entities", {}).get(wd["qid"], {}).get("sitelinks", {})
        for k, host in (("jawiki", "ja.wikipedia.org"), ("enwiki", "en.wikipedia.org"),
                        ("jawikivoyage", "ja.wikivoyage.org"), ("enwikivoyage", "en.wikivoyage.org")):
            if k in sl:
                links[host] = sl[k]["title"]
    if "ja.wikipedia.org" not in links:
        # 名前で探す。取り違えを避けて、記事名に名前が含まれるときだけ採る
        hit = search_title("ja.wikipedia.org", t["name"])
        if hit and (t["name"].split()[0] in hit or hit in t["name"]):
            links["ja.wikipedia.org"] = hit
    files = {}
    for host, title in links.items():
        for f in titles_for(host, title):
            files.setdefault(f, []).append(host)
    return {"slug": t["slug"], "articles": links, "files": files}

def phase_b(t, a, r1):
    toks = R.tokens(t) | {t["region"].get("prefecture", "").lower()} if t.get("region") else R.tokens(t)
    toks = {x for x in R.tokens(t)}
    seen1 = {i["title"] for i in (r1 or {}).get("commons", [])}
    pool = {}
    for f, hosts in (a or {}).get("files", {}).items():
        if f not in seen1:
            pool.setdefault(f, set()).update("article:" + h for h in hosts)
    centers = []
    if t.get("coords"):
        centers.append((t["coords"]["lat"], t["coords"]["lng"]))
    wd = (r1 or {}).get("wikidata") or {}
    if wd.get("coords"):
        centers.append(tuple(wd["coords"]))
    for c in centers:
        for title, dist in R.commons_geo(c[0], c[1], radius=5000, limit=300):
            if title not in seen1 and R.named(title, toks):
                pool.setdefault(title, set()).add("commons-geo5km-named")
    pref = (t.get("region") or {}).get("prefecture") or ""
    qs = set()
    for al in (t.get("aliases") or [])[:3]:
        qs.add(al)
    if pref:
        qs.add(f"{t['name']} {pref}")
    for q in qs:
        for title in R.commons_search(q):
            if title not in seen1 and R.named(title, toks):
                pool.setdefault(title, set()).add("commons-search-alias")
    infos = R.commons_info(sorted(pool)) if pool else []
    for i in infos:
        i["sources"] = sorted(pool.get(i["title"], []))
        i["named"] = R.named((i["title"] or "") + " " + (i.get("desc") or ""), toks)
    return infos

def main():
    phase = sys.argv[1]
    targets = json.load(open(os.path.join(os.path.dirname(__file__), "targets.json")))
    only = set(json.load(open(os.path.join(os.path.dirname(__file__), "need2.json")))) if phase == "B" else None
    for n, t in enumerate(targets, 1):
        if only is not None and t["slug"] not in only:
            continue
        p1 = os.path.join(R.OUT, t["slug"] + ".json")
        r1 = json.load(open(p1)) if os.path.exists(p1) else None
        pa = os.path.join(OUT, t["slug"] + ".A.json")
        if phase == "A":
            if os.path.exists(pa):
                continue
            if r1 is None:
                # 1巡目の Wikidata の結果を待つ（無ければ台帳の QID だけで）
                r1 = {"wikidata": {"qid": t.get("wikidata")}} if t.get("wikidata") else None
            try:
                a = phase_a(t, r1)
            except Exception as e:
                a = {"slug": t["slug"], "_error": repr(e)}
            json.dump(a, open(pa, "w"), ensure_ascii=False, indent=1)
            print(f"A [{n}] {t['slug']} articles={list(a.get('articles', {}).keys())} files={len(a.get('files', {}))}", flush=True)
        else:
            pb = os.path.join(OUT, t["slug"] + ".B.json")
            if os.path.exists(pb):
                continue
            a = json.load(open(pa)) if os.path.exists(pa) else None
            try:
                b = phase_b(t, a, r1)
            except Exception as e:
                b = [{"_error": repr(e)}]
            json.dump(b, open(pb, "w"), ensure_ascii=False, indent=1)
            print(f"B [{n}] {t['slug']} ok={sum(1 for i in b if i.get('ok'))}", flush=True)

if __name__ == "__main__":
    main()
